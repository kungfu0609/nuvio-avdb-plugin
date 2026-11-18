var BASE_API = "https://avdbapi.com/api.php/provide/vod";
var UA = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function unpackDeanEdwards(packed) {
    try {
        var match = packed.match(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!match) return "";
        var p = match[1], a = parseInt(match[2], 10), c = parseInt(match[3], 10), k = match[4].split("|");
        var e = function (num) { return (num < a ? "" : e(parseInt(num / a, 10))) + ((num = num % a) > 35 ? String.fromCharCode(num + 29) : num.toString(36)); };
        var dict = {};
        while (c--) dict[e(c)] = k[c] || e(c);
        return p.replace(/\b\w+\b/g, function (w) { return dict[w] || w; });
    } catch (err) { return ""; }
}

function extractHlsLocal(embedUrl) {
    var origin = embedUrl.split("/").slice(0,3).join("/");
    return fetch(embedUrl, {
        method: "GET",
        headers: { "User-Agent": UA, "Referer": "https://avdbapi.com/", "Sec-Fetch-Dest": "iframe" }
    })
    .then(function (res) { return res.text(); })
    .then(function (html) {
        var unpacked = html.indexOf("eval(function(p,a,c,k,e,") !== -1 ? unpackDeanEdwards(html) : "";
        var combined = (html + "\n" + unpacked).replace(/\\\//g, "/");
        var m = combined.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)/i);
        if (m) return { url: m[0].replace(/\\/g, ""), origin: origin, referer: embedUrl };
        return null;
    })
    .catch(function () { return null; });
}

function getStreams(tmdbId, mediaType, season, episode) {
    var rawId = String(tmdbId || "").trim();
    
    // Nếu Nuvio truyền đúng ID chứa tt99...
    if (rawId.indexOf("tt99") === 0) {
        var numericId = rawId.replace("tt99", "");
        return fetch(BASE_API + "?ac=detail&ids=" + encodeURIComponent(numericId), { 
            headers: { "User-Agent": UA, "Referer": "https://avdbapi.com/" } 
        })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (json) {
            var list = json && Array.isArray(json.list) ? json.list.slice(0, 1) : [];
            var tasks = [];

            list.forEach(function (item) {
                var serverData = (item.episodes && item.episodes.server_data) || {};
                Object.keys(serverData).forEach(function (epName) {
                    var embedUrl = (serverData[epName].link_embed || "").trim();
                    var directM3u8 = (serverData[epName].link_m3u8 || "").trim();

                    if (directM3u8) {
                        tasks.push(Promise.resolve({
                            name: "AVDB Native", 
                            title: "▶️ Phát Trực Tiếp (" + epName + ")", 
                            url: directM3u8,
                            headers: { "User-Agent": UA, "Referer": "https://upload18.org/" }
                        }));
                    } else if (embedUrl) {
                        tasks.push(
                            extractHlsLocal(embedUrl).then(function (res) {
                                if (!res || !res.url) return null;
                                return {
                                    name: "AVDB Native",
                                    title: "▶️ Phát Trực Tiếp (" + epName + ")",
                                    url: res.url,
                                    headers: { "User-Agent": UA, "Referer": res.referer, "Origin": res.origin }
                                };
                            })
                        );
                    }
                });
            });

            return Promise.all(tasks).then(function (arr) { return arr.filter(Boolean); });
        }).catch(function () { return []; });
    }
    
    return Promise.resolve([]);
}

module.exports = { getStreams: getStreams };
