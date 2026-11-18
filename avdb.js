var BASE_API = "https://avdbapi.com/api.php/provide/vod";
var UA = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15";

function unpackDeanEdwards(p, a, c, k) {
    while (c--) {
        if (k[c]) {
            var reg = new RegExp('\\b' + c.toString(a) + '\\b', 'g');
            p = p.replace(reg, k[c]);
        }
    }
    return p;
}

function extractHls(embedUrl) {
    var parts = embedUrl.split("/");
    var hash = parts[parts.length - 1] || "";
    var origin = parts.slice(0, 3).join("/");
    
    var headers = {
        "User-Agent": UA,
        "Referer": embedUrl,
        "Origin": origin
    };

    // 1. Gửi POST đâm thẳng vào API ẩn của Upload18
    return fetch(origin + "/api/source/" + hash, {
        method: "POST",
        headers: {
            "User-Agent": headers["User-Agent"],
            "Referer": headers["Referer"],
            "Origin": headers["Origin"],
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "r=https%3A%2F%2Favdbapi.com%2F&d=" + origin.replace("https://", "")
    })
    .then(function(res) { return res.text(); })
    .then(function(text) {
        var cleanText = text.replace(/\\\//g, "/");
        var m = cleanText.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)/i);
        if (m) return m[0];
        throw new Error("API POST Failed");
    })
    .catch(function() {
        // 2. Dự phòng: Quét trang HTML nếu API bị đổi
        return fetch(embedUrl, { 
            headers: { "User-Agent": UA, "Referer": "https://avdbapi.com/" } 
        })
        .then(function(res) { return res.text(); })
        .then(function(html) {
            var packedMatch = html.match(/eval\(function\(p,a,c,k,e,[dr]\)\{.*?\}\((.*?)\)\)/);
            var unpacked = "";
            if (packedMatch) {
                try {
                    // Dùng JSON.parse an toàn thay vì eval để tương thích QuickJS
                    var strArgs = "[" + packedMatch[1] + "]";
                    var args = eval(strArgs); 
                    unpacked = unpackDeanEdwards(args[0], args[1], args[2], args[3].split('|'));
                } catch(e) {}
            }
            var combined = (html + "\n" + unpacked).replace(/\\\//g, "/");
            var m = combined.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)/i);
            return m ? m[0] : null;
        });
    });
}

function getStreams(tmdbId) {
    var id = String(tmdbId || "");
    
    // Bắt đúng tín hiệu từ Catalog Addon
    if (id.indexOf("avdb_") !== 0) return Promise.resolve([]);
    var numId = id.split("_")[1];

    return fetch(BASE_API + "?ac=detail&ids=" + numId)
    .then(function(res) { return res.json(); })
    .then(function(data) {
        var item = (data && data.list && data.list[0]) || {};
        var serverData = (item.episodes && item.episodes.server_data) || {};
        var promises = [];
        
        Object.keys(serverData).forEach(function(epName) {
            var embedUrl = (serverData[epName].link_embed || "").trim();
            var directM3u8 = (serverData[epName].link_m3u8 || "").trim();
            
            if (directM3u8) {
                promises.push(Promise.resolve({
                    name: "AVDB Native",
                    title: "▶️ Phát Trực Tiếp (" + epName + ")",
                    url: directM3u8,
                    quality: "1080p",
                    headers: { "User-Agent": UA, "Referer": "https://upload18.org/" }
                }));
            } else if (embedUrl) {
                promises.push(
                    extractHls(embedUrl).then(function(m3u8Url) {
                        if (!m3u8Url) return null;
                        var origin = embedUrl.split('/').slice(0, 3).join('/');
                        return {
                            name: "AVDB Native",
                            title: "▶️ Phát Trực Tiếp (" + epName + ")",
                            url: m3u8Url,
                            quality: "1080p",
                            // Quan trọng: Phải truyền header cho Nuvio Native Player
                            headers: { "User-Agent": UA, "Referer": origin + "/", "Origin": origin }
                        };
                    })
                );
            }
        });
        
        return Promise.all(promises).then(function(results) {
            var validStreams = [];
            for (var i = 0; i < results.length; i++) {
                if (results[i]) validStreams.push(results[i]);
            }
            return validStreams;
        });
    })
    .catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
