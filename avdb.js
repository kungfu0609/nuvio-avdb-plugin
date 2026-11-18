const BASE_API = "https://avdbapi.com/api.php/provide/vod";
const CINEMETA_BASE = "https://v3-cinemeta.strem.io/meta";
const UA = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function unpackDeanEdwards(packed) {
    try {
        const match = packed.match(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!match) return packed;
        const p = match[1];
        const a = parseInt(match[2], 10);
        let c = parseInt(match[3], 10);
        const k = match[4].split("|");
        const e = function (num) {
            return (num < a ? "" : e(parseInt(num / a, 10))) + ((num = num % a) > 35 ? String.fromCharCode(num + 29) : num.toString(36));
        };
        const dict = {};
        while (c--) dict[e(c)] = k[c] || e(c);
        return p.replace(/\b\w+\b/g, function (w) { return dict[w] || w; });
    } catch (err) {
        return packed;
    }
}

function getOrigin(urlStr) {
    const match = String(urlStr || "").match(/^(https?:\/\/[^\/]+)/i);
    return match ? match[1] : "https://upload18.org";
}

function extractHlsOnIpad(embedUrl) {
    if (!embedUrl) return Promise.resolve(null);
    const embedOrigin = getOrigin(embedUrl);

    return fetch(embedUrl, {
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
    })
        .then(function (res) { return res.text(); })
        .then(function (rawHtml) {
            const decodedHtml = rawHtml.indexOf("eval(function(p,a,c,k,e,") !== -1
                ? rawHtml + "\n" + unpackDeanEdwards(rawHtml)
                : rawHtml;

            const mediaMatch = decodedHtml.match(/https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/i);
            if (mediaMatch && mediaMatch[0]) {
                return {
                    url: mediaMatch[0].replace(/\\\//g, "/").replace(/\\/g, ""),
                    origin: embedOrigin
                };
            }
            return null;
        })
        .catch(function () { return null; });
}

function resolveApiUrl(itemId, mediaType) {
    const rawId = String(itemId || "").trim();

    // Nhận trực tiếp ID từ AVDB Addon trên Render (ví dụ: avdb_653546)
    if (rawId.indexOf("avdb_") === 0) {
        const numericId = rawId.replace("avdb_", "").split(":")[0];
        return Promise.resolve(BASE_API + "?ac=detail&ids=" + encodeURIComponent(numericId));
    }

    // Nhận mã JAV trực tiếp
    if (/^[a-zA-Z]{2,6}-\d{2,5}$/i.test(rawId)) {
        return Promise.resolve(BASE_API + "?ac=detail&wd=" + encodeURIComponent(rawId.toUpperCase()));
    }

    // Fallback qua Cinemeta nếu mở từ danh mục TMDB/IMDb
    const type = mediaType === "tv" ? "series" : "movie";
    const metaId = rawId.indexOf("tt") === 0 ? rawId : "tmdb:" + rawId;

    return fetch(CINEMETA_BASE + "/" + type + "/" + encodeURIComponent(metaId) + ".json", {
        headers: { "User-Agent": UA }
    })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
            const name = data && data.meta && data.meta.name ? data.meta.name : "";
            if (!name) return "";
            const codeMatch = name.match(/\b([A-Z]{2,6}-\d{2,5})\b/i);
            const query = codeMatch ? codeMatch[1].toUpperCase() : name;
            return BASE_API + "?ac=detail&wd=" + encodeURIComponent(query);
        })
        .catch(function () { return ""; });
}

function getStreams(itemId, mediaType, season, episode) {
    return resolveApiUrl(itemId, mediaType)
        .then(function (apiUrl) {
            if (!apiUrl) return [];
            return fetch(apiUrl, {
                headers: { "User-Agent": UA, "Referer": "https://avdbapi.com/" }
            })
                .then(function (res) { return res.ok ? res.json() : null; })
                .then(function (json) {
                    const list = json && Array.isArray(json.list) ? json.list.slice(0, 3) : [];
                    const tasks = [];

                    list.forEach(function (item) {
                        const serverData = (item.episodes && item.episodes.server_data) || {};
                        const codePrefix = item.movie_code ? "[" + item.movie_code + "] " : "";
                        const itemTitle = item.name || item.movie_code || "AVDB";

                        Object.keys(serverData).forEach(function (epName) {
                            const epInfo = serverData[epName] || {};
                            const directM3u8 = (epInfo.link_m3u8 || "").trim();
                            const embedUrl = (epInfo.link_embed || "").trim();

                            if (directM3u8) {
                                const origin = embedUrl ? getOrigin(embedUrl) : "https://upload18.org";
                                tasks.push(Promise.resolve({
                                    name: "AVDB Direct (iPad)",
                                    title: "▶️ " + codePrefix + itemTitle + " (" + epName + ")",
                                    url: directM3u8,
                                    quality: "1080p",
                                    headers: {
                                        "User-Agent": UA,
                                        "Referer": origin + "/",
                                        "Origin": origin
                                    }
                                }));
                            } else if (embedUrl) {
                                tasks.push(
                                    extractHlsOnIpad(embedUrl).then(function (extracted) {
                                        if (extracted && extracted.url) {
                                            return {
                                                name: "AVDB Native HLS",
                                                title: "▶️ " + codePrefix + itemTitle + " (" + epName + ")",
                                                url: extracted.url,
                                                quality: "1080p",
                                                headers: {
                                                    "User-Agent": UA,
                                                    "Referer": extracted.origin + "/",
                                                    "Origin": extracted.origin
                                                }
                                            };
                                        }
                                        return null;
                                    })
                                );
                            }
                        });
                    });

                    return Promise.all(tasks).then(function (results) {
                        return results.filter(Boolean);
                    });
                });
        })
        .catch(function () { return []; });
}

module.exports = { getStreams: getStreams };
