/**
 * Nuvio Native Provider Plugin: AVDBAPI
 * Executes internally inside Nuvio app (No 127.0.0.1 / local server required)
 */

const BASE_API = "https://avdbapi.com/api.php/provide/vod";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// Khóa TMDB public read-only hoặc dùng Cinemeta fallback để lấy tên/mã phim từ tmdbId
const CINEMETA_BASE = "https://v3-cinemeta.strem.io/meta";

/**
 * Helper: Giải mã đoạn script packed (eval(function(p,a,c,k,e,d)...)) nếu Upload18 obfuscate link m3u8
 */
function unpackDeanEdwards(packed) {
    try {
        const match = packed.match(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!match) return packed;
        let [, p, aStr, cStr, kStr] = match;
        const a = parseInt(aStr, 10);
        let c = parseInt(cStr, 10);
        const k = kStr.split("|");
        const e = (c) => (c < a ? "" : e(parseInt(c / a, 10))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
        const dict = {};
        while (c--) dict[e(c)] = k[c] || e(c);
        return p.replace(/\b\w+\b/g, (w) => dict[w] || w);
    } catch {
        return packed;
    }
}

/**
 * Bước 1: Lấy tên phim hoặc mã JAV từ ID mà Nuvio truyền vào
 */
async function resolveSearchKeywords(tmdbId, mediaType) {
    const keywords = [];
    const rawId = String(tmdbId || "").trim();

    // Nếu người dùng mở trực tiếp ID dạng avdb_653546 hoặc mã phim (vd: SSIS-001)
    if (rawId.startsWith("avdb_")) {
        return { directId: rawId.replace("avdb_", ""), keywords: [] };
    }
    if (/^[a-zA-Z]{2,6}-\d{2,5}$/i.test(rawId)) {
        return { directId: null, keywords: [rawId.toUpperCase()] };
    }

    // Thử lấy metadata từ Cinemeta nếu là IMDb ID (tt...) hoặc TMDB ID
    try {
        const type = mediaType === "tv" ? "series" : "movie";
        const metaId = rawId.startsWith("tt") ? rawId : `tmdb:${rawId}`;
        const res = await fetch(`${CINEMETA_BASE}/${type}/${encodeURIComponent(metaId)}.json`, {
            headers: { "User-Agent": UA }
        });
        if (res.ok) {
            const data = await res.json();
            const name = data?.meta?.name || "";
            if (name) {
                keywords.push(name);
                // Tách mã JAV nếu nằm trong tiêu đề (ví dụ: "[SSIS-123] Title" -> "SSIS-123")
                const codeMatch = name.match(/\b([A-Z]{2,6}-\d{2,5})\b/i);
                if (codeMatch) keywords.unshift(codeMatch[1].toUpperCase());
            }
        }
    } catch (err) {
        console.log("[AVDB Plugin] Meta lookup error:", err.message);
    }

    return { directId: null, keywords };
}

/**
 * Bước 2: Trích xuất link .m3u8 trực tiếp từ link_embed của Upload18
 * Gửi kèm Sec-Fetch-Dest: iframe & Referer để vượt qua trang /login redirect
 */
async function extractHlsFromEmbed(embedUrl) {
    if (!embedUrl) return null;
    try {
        const embedOrigin = new URL(embedUrl).origin;
        const res = await fetch(embedUrl, {
            method: "GET",
            headers: {
                "User-Agent": UA,
                "Referer": "https://avdbapi.com/",
                "Origin": "https://avdbapi.com",
                "Sec-Fetch-Dest": "iframe",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "cross-site",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            }
        });

        const rawHtml = await res.text();
        // Giải mã nếu HTML có chứa packed JS
        const decodedHtml = rawHtml.includes("eval(function(p,a,c,k,e,")
            ? rawHtml + "\n" + unpackDeanEdwards(rawHtml)
            : rawHtml;

        // Tìm URL .m3u8 hoặc master playlist
        const m3u8Match = decodedHtml.match(/https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/i);
        if (m3u8Match) {
            return {
                url: m3u8Match[0].replace(/\\\//g, "/"),
                origin: embedOrigin
            };
        }
    } catch (err) {
        console.log("[AVDB Plugin] Embed extract error:", err.message);
    }
    return null;
}

/**
 * Entrypoint chính của Nuvio Plugin
 */
async function getStreams(tmdbId, mediaType = "movie", season = null, episode = null) {
    const streams = [];

    try {
        const { directId, keywords } = await resolveSearchKeywords(tmdbId, mediaType);
        let apiUrl = "";

        if (directId) {
            apiUrl = `${BASE_API}?ac=detail&ids=${encodeURIComponent(directId)}`;
        } else if (keywords.length > 0) {
            apiUrl = `${BASE_API}?ac=detail&wd=${encodeURIComponent(keywords[0])}`;
        } else {
            return [];
        }

        const apiRes = await fetch(apiUrl, {
            headers: {
                "User-Agent": UA,
                "Referer": "https://avdbapi.com/"
            }
        });

        if (!apiRes.ok) return [];
        const json = await apiRes.json();
        const list = Array.isArray(json?.list) ? json.list : [];

        // Lấy tối đa 3 kết quả khớp nhất để tránh timeout trong Nuvio
        for (const item of list.slice(0, 3)) {
            const serverData = item.episodes?.server_data || {};
            const codeLabel = item.movie_code ? `[${item.movie_code}] ` : "";

            for (const epName of Object.keys(serverData)) {
                const epInfo = serverData[epName] || {};
                const directM3u8 = (epInfo.link_m3u8 || "").trim();
                const embedUrl = (epInfo.link_embed || "").trim();

                // Trường hợp 1: AVDB trả thẳng link_m3u8
                if (directM3u8) {
                    streams.push({
                        name: "AVDB Direct",
                        title: `${codeLabel}${item.name} (${epName})`,
                        url: directM3u8,
                        quality: "1080p",
                        headers: {
                            "User-Agent": UA,
                            "Referer": "https://upload18.org/",
                            "Origin": "https://upload18.org"
                        }
                    });
                    continue;
                }

                // Trường hợp 2: Bóc tách .m3u8 từ trang link_embed của Upload18
                if (embedUrl) {
                    const extracted = await extractHlsFromEmbed(embedUrl);
                    if (extracted && extracted.url) {
                        streams.push({
                            name: "AVDB HLS",
                            title: `${codeLabel}${item.name} (${epName})`,
                            url: extracted.url,
                            quality: "HD",
                            headers: {
                                "User-Agent": UA,
                                "Referer": `${extracted.origin}/`,
                                "Origin": extracted.origin
                            }
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.log("[AVDB Plugin] Fatal error:", error.message);
    }

    return streams;
}

// Export chuẩn CommonJS mà Nuvio Plugin Runtime yêu cầu
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams };
}