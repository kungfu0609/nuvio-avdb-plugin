var BASE_API = "https://avdbapi.com/api.php/provide/vod";

function extractLocalUpload18(embedUrl) {
    var parts = embedUrl.split("?")[0].split("/");
    var hash = parts[parts.length - 1];
    var origin = parts.slice(0, 3).join("/");

    if (!hash) return Promise.resolve(null);

    return fetch(origin + "/api/source/" + hash, {
        method: "POST",
        headers: {
            "User-Agent": "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
            "Referer": embedUrl,
            "Origin": origin,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "r=https%3A%2F%2Favdbapi.com%2F&d=" + origin.replace("https://", "")
    })
    .then(function(res) { return res.text(); })
    .then(function(txt) {
        var cleanTxt = txt.replace(/\\\//g, "/");
        var match = cleanTxt.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)/i);
        return match ? match[0] : null;
    })
    .catch(function() { return null; });
}

function getStreams(tmdbId, mediaType, season, episode) {
    var rawId = String(tmdbId || "").trim();
    
    // Nuvio Plugin sẽ tự động nhận diện ID có tiền tố avdb_
    if (rawId.indexOf("avdb_") !== 0) return Promise.resolve([]);
    
    var numericId = rawId.replace("avdb_", "").split(":")[0];
    
    return fetch(BASE_API + "?ac=detail&ids=" + encodeURIComponent(numericId))
        .then(function(res) { return res.json(); })
        .then(function(json) {
            var list = json && json.list ? json.list : [];
            if (list.length === 0) return [];
            
            var serverData = list[0].episodes && list[0].episodes.server_data ? list[0].episodes.server_data : {};
            var tasks = [];
            
            Object.keys(serverData).forEach(function(epName) {
                var epInfo = serverData[epName] || {};
                var embedUrl = epInfo.link_embed || "";
                var directM3u8 = epInfo.link_m3u8 || "";
                
                if (directM3u8) {
                    tasks.push(Promise.resolve({
                        name: "AVDB Plugin",
                        title: "▶️ Nuvio Plugin Native (" + epName + ")",
                        url: directM3u8
                    }));
                } else if (embedUrl) {
                    tasks.push(
                        extractLocalUpload18(embedUrl).then(function(extractedUrl) {
                            if (!extractedUrl) return null;
                            return {
                                name: "AVDB Plugin",
                                title: "▶️ Nuvio Plugin Native (" + epName + ")",
                                url: extractedUrl,
                                headers: {
                                    "Referer": "https://upload18.org/",
                                    "User-Agent": "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15"
                                }
                            };
                        })
                    );
                }
            });
            
            return Promise.all(tasks).then(function(results) {
                // Lọc bỏ các kết quả null (trích xuất thất bại)
                var validStreams = [];
                for (var i = 0; i < results.length; i++) {
                    if (results[i] !== null) validStreams.push(results[i]);
                }
                return validStreams;
            });
        })
        .catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
