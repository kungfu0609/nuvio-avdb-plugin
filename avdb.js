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
    
    // Đâm trực tiếp API nguồn bằng Fetch của iPad
    return fetch(origin + "/api/source/" + hash, {
        method: "POST",
        headers: {
            "User-Agent": UA,
            "Referer": embedUrl,
            "Origin": origin,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "r=https%3A%2F%2Favdbapi.com%2F&d=" + origin.replace("https://", "")
    })
    .then(function(res) { return res.text(); })
    .then(function(txt) {
        var m = txt.replace(/\\\//g, "/").match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)/i);
        if (m) return m[0];
        
        // Dự phòng cào HTML
        return fetch(embedUrl, { headers: { "User-Agent": UA, "Referer": "https://avdbapi.com/" } })
        .then(function(res) { return res.text(); })
        .then(function(html) {
            var packed = html.match(/eval\(function\(p,a,c,k,e,[dr]\)\{.*?\}\((.*?)\)\)/);
            var unpacked = "";
            if (packed) {
                try {
                    var args = eval("[" + packed[1] + "]");
                    unpacked = unpackDeanEdwards(args[0], args[1], args[2], args[3].split('|'));
                } catch(e) {}
            }
            var m2 = (html + "\n" + unpacked).replace(/\\\//g, "/").match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)/i);
            return m2 ? m2[0] : null;
        });
    }).catch(function() { return null; });
}

function getStreams(tmdbId) {
    var id = String(tmdbId || "");
    
    // BẮT ĐÚNG TIỀN TỐ tt99 TỪ ADDON RENDER ĐỂ KÍCH HOẠT PLUGIN
    if (id.indexOf("tt99") !== 0) return Promise.resolve([]);
    
    var numId = id.replace("tt99", "");
    
    return fetch(BASE_API + "?ac=detail&ids=" + numId)
    .then(function(res) { return res.json(); })
    .then(function(data) {
        var list = data && data.list ? data.list : [];
        if (list.length === 0) return [];
        
        var serverData = list[0].episodes && list[0].episodes.server_data ? list[0].episodes.server_data : {};
        var promises = [];
        
        Object.keys(serverData).forEach(function(epName) {
            var embedUrl = (serverData[epName].link_embed || "").trim();
            var directM3u8 = (serverData[epName].link_m3u8 || "").trim();
            
            if (directM3u8) {
                promises.push(Promise.resolve({
                    name: "AVDB Native",
                    title: "▶️ Phát Trực Tiếp (" + epName + ")",
                    url: directM3u8,
                    // Cấu trúc y hệt chuẩn base.js của VietStream
                    behaviorHints: { notWebReady: false, proxyHeaders: { request: { "Referer": "https://upload18.org/" } } }
                }));
            } else if (embedUrl) {
                promises.push(
                    extractHls(embedUrl).then(function(url) {
                        if (!url) return null;
                        var origin = embedUrl.split("/").slice(0, 3).join("/");
                        return {
                            name: "AVDB Native",
                            title: "▶️ Phát Trực Tiếp (" + epName + ")",
                            url: url,
                            behaviorHints: { notWebReady: false, proxyHeaders: { request: { "Referer": origin + "/", "Origin": origin } } }
                        };
                    })
                );
            }
        });
        
        return Promise.all(promises).then(function(arr) {
            var valid = [];
            for (var i = 0; i < arr.length; i++) { if (arr[i]) valid.push(arr[i]); }
            return valid;
        });
    }).catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
