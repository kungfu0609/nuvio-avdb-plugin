/**
 * Nuvio Native Plugin: AVDB Direct Player (avdb.js)
 * Tối ưu cho QuickJS / Hermes trên Nuvio iPadOS
 */

var BASE_API = "https://avdbapi.com/api.php/provide/vod";
var CINEMETA_BASE = "https://v3-cinemeta.strem.io/meta";
var UA = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function getOrigin(urlStr) {
    var m = String(urlStr || "").match(/^(https?:\/\/[^\/]+)/i);
    return m ? m[1] : "https://upload18.org";
}

function getHost(urlStr) {
    var m = String(urlStr || "").match(/^https?:\/\/([^\/]+)/i);
    return m ? m[1] : "upload18.org";
}

function unpackDeanEdwards(packed) {
    try {
        var match = packed.match(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!match) return "";
        var p = match[1];
        var a = parseInt(match[2], 10);
        var c = parseInt(match[3], 10);
        var k = match[4].split("|");
        var e = function (num) {
            return (num < a ? "" : e(parseInt(num / a, 10))) + ((num = num % a) > 35 ? String.fromCharCode(num + 29) : num.toString(36));
        };
        var dict = {};
        while (c--) {
            dict[e(c)] = k[c] || e(c);
        }
        return p.replace(/\b\w+\b/g, function (w) {
            return dict[w] || w;
        });
    } catch (err) {
        return "";
    }
}

function extractStreamFromUpload18(embedUrl) {
    if (!embedUrl) return Promise.resolve(null);
    var origin = getOrigin(embedUrl);
    var host = getHost(embedUrl);
    var parts = embedUrl.split("?")[0].split("/").filter(Boolean);
    var hash = parts[parts.length - 1] || "";

    // Bước 1: Thử gọi API nguồn trực tiếp bằng IP Wi-Fi của iPad
    var tryApi = hash
        ? fetch(origin + "/api/source/" + hash, {
              method: "POST",
              headers: {
                  "User-Agent": UA,
                  "Referer": embedUrl,
                  "Origin": origin,
                  "X-Requested-With": "XMLHttpRequest",
                  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
              },
              body: "r=https%3A%2F%2Favdbapi.com%2F&d=" + encodeURIComponent(host)
          })
              .then(function (r) { return r.text(); })
              .then(function (txt) {
                  var clean = txt.replace(/\\\//g, "/");
                  var m = clean.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/i);
                  return m ? { url: m[0], origin: origin, referer: embedUrl } : null;
              })
              .catch(function () { return null; })
        : Promise.resolve(null);

    return tryApi.then(function (apiResult) {
        if (apiResult) return apiResult;

        // Bước 2: Tải trang embed với Sec-Fetch-Dest: iframe trên IP của iPad
        return fetch(embedUrl, {
            method: "GET",
            headers: {
                "User-Agent": UA,
                "Referer": "https://avdbapi.com/",
                "Origin": "https://avdbapi.com",
                "Sec-Fetch-Dest": "iframe",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "cross-site"
            }
        })
            .then(function (res) { return res.text(); })
            .then(function (html) {
                var unpacked = html.indexOf("eval(function(p,a,c,k,e,") !== -1 ? unpackDeanEdwards(html) : "";
                var combined = (html + "\n" + unpacked).replace(/\\\//g, "/");
                var m = combined.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/i);
                if (m) {
                    return { url: m[0].replace(/\\/g, ""), origin: origin, referer: embedUrl };
                }
                return null;
            })
            .catch(function () { return null; });
    });
}
function getStreams(tmdbId, mediaType, season, episode) {
    var rawId = String(tmdbId || "").trim();
    var queryPromise;

    // 1. Đón lõng Fake IMDb ID từ máy chủ Render truyền xuống
    if (rawId.indexOf("tt99") === 0) {
        var numericId = rawId.replace("tt99", "");
        queryPromise = Promise.resolve(BASE_API + "?ac=detail&ids=" + encodeURIComponent(numericId));
    } 
    // 2. Các logic fallback cũ (Mã JAV, TMDB chuẩn)
    else if (rawId.indexOf("avdb_") === 0) {
        var plainId = rawId.replace("avdb_", "").split(":")[0];
        queryPromise = Promise.resolve(BASE_API + "?ac=detail&ids=" + encodeURIComponent(plainId));
    } 
    else if (/^[a-zA-Z]{2,6}-\d{2,5}$/i.test(rawId)) {
        queryPromise = Promise.resolve(BASE_API + "?ac=detail&wd=" + encodeURIComponent(rawId.toUpperCase()));
    } 
    else {
        var type = mediaType === "tv" ? "series" : "movie";
        var metaId = rawId.indexOf("tt") === 0 ? rawId : "tmdb:" + rawId;
        queryPromise = fetch(CINEMETA_BASE + "/" + type + "/" + encodeURIComponent(metaId) + ".json")
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                var name = data && data.meta && data.meta.name ? data.meta.name : "";
                if (!name) return "";
                var codeMatch = name.match(/\b([A-Z]{2,6}-\d{2,5})\b/i);
                var kw = codeMatch ? codeMatch[1].toUpperCase() : name;
                return BASE_API + "?ac=detail&wd=" + encodeURIComponent(kw);
            })
            .catch(function () { return ""; });
    }

    return queryPromise
        .then(function (apiUrl) {
            if (!apiUrl) return [];
            return fetch(apiUrl, {
                headers: { "User-Agent": UA, "Referer": "https://avdbapi.com/" }
            })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (json) {
                    var list = json && Array.isArray(json.list) ? json.list.slice(0, 2) : [];
                    var tasks = [];

                    list.forEach(function (item) {
                        var serverData = (item.episodes && item.episodes.server_data) || {};
                        var label = item.movie_code ? "[" + item.movie_code + "] " : "";

                        Object.keys(serverData).forEach(function (epName) {
                            var epInfo = serverData[epName] || {};
                            var embedUrl = (epInfo.link_embed || "").trim();

                            if (embedUrl) {
                                tasks.push(
                                    // Hàm extractStreamFromUpload18 giữ nguyên như bản trước
                                    extractStreamFromUpload18(embedUrl).then(function (res) {
                                        if (!res || !res.url) return null;
                                        return {
                                            name: "AVDB Plugin",
                                            title: "▶️ Phát Trực Tiếp (iPad Native)",
                                            url: res.url,
                                            quality: "1080p",
                                            headers: {
                                                "User-Agent": UA,
                                                "Referer": res.referer,
                                                "Origin": res.origin
                                            }
                                        };
                                    })
                                );
                            }
                        });
                    });

                    return Promise.all(tasks).then(function (arr) {
                        return arr.filter(Boolean);
                    });
                });
        })
        .catch(function () {
            return [];
        });
}

module.exports = { getStreams: getStreams };
