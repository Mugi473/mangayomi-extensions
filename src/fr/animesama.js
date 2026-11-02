const mangayomiSources = [{
    "name": "Anime-Sama",
    "lang": "fr",
    "baseUrl": "https://anime-sama.to",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/Mugi473/mangayomi-extensions/main/icons/animesama.png",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.0.3",
    "pkgPath": "src/fr/animesama.js"
}];

class DefaultExtension extends MProvider {
    getHeaders(url) {
        return {
            "Referer": this.source.baseUrl + "/",
            "User-Agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        };
    }

    async requestRes(url) {
        return await new Client().get(url, this.getHeaders(url));
    }

    parseCatalog(res) {
        const html = res.body || "";
        const doc = new Document(html);
        const list = [];
        const seen = new Set();

        // Sélection directe basée sur la structure exacte visible sur ta capture d'écran
        const cards = doc.select("a.as-carte-lien");

        for (const a of cards) {
            let href = a.attr("href") || "";
            if (!href.includes("/catalogue/")) continue;

            if (href.startsWith("/")) href = this.source.baseUrl + href;
            href = href.split("?")[0].replace(/\/$/, "");
            if (seen.has(href)) continue;

            const titleEl = a.selectFirst("h3.as-carte-titre");
            const name = titleEl ? titleEl.text.trim() : "";
            if (!name) continue;

            const imgEl = a.selectFirst("img");
            let imageUrl = imgEl ? (imgEl.attr("src") || imgEl.attr("data-src") || "") : "";
            if (imageUrl.startsWith("/")) imageUrl = this.source.baseUrl + imageUrl;

            seen.add(href);
            list.push({
                name: name,
                link: href,
                imageUrl: imageUrl
            });
        }

        // Sécurité de secours si le parseur DOM ne trouve pas les cartes
        if (list.length === 0) {
            const regex = /href=["']((?:https?:\/\/[^"']+)?\/catalogue\/([^"'\/?#]+))\/?["']/gi;
            let match;
            while ((match = regex.exec(html)) !== null) {
                let href = match[1];
                const slug = match[2];
                if (!slug || slug === "index.php" || slug === "catalogue") continue;
                if (href.startsWith("/")) href = this.source.baseUrl + href;
                if (seen.has(href)) continue;

                seen.add(href);
                list.push({
                    name: slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
                    link: href,
                    imageUrl: `https://cdn.statically.io/gh/Anime-Sama/IMG/img/contenu/${slug}.jpg`
                });
            }
        }

        return {
            list: list,
            hasNextPage: list.length >= 10
        };
    }

    async getPopular(page) {
        const url = `${this.source.baseUrl}/catalogue/?type%5B%5D=Anime&page=${page}`;
        const res = await this.requestRes(url);
        return this.parseCatalog(res);
    }

    async getLatestUpdates(page) {
        const url = `${this.source.baseUrl}/catalogue/?page=${page}`;
        const res = await this.requestRes(url);
        return this.parseCatalog(res);
    }

    async search(query, page, filters) {
        const url = `${this.source.baseUrl}/catalogue/?search=${encodeURIComponent(query)}&page=${page}`;
        const res = await this.requestRes(url);
        return this.parseCatalog(res);
    }

    async getDetail(url) {
        const baseUrl = url.startsWith("http") ? url : this.source.baseUrl + url;
        const res = await this.requestRes(baseUrl);
        const html = res.body || "";
        const doc = new Document(html);

        const name = doc.selectFirst("#titreOeuvre, h1, h2")?.text.trim() || "Anime";
        const imageUrl = doc.selectFirst("#coverOeuvre, img")?.attr("src") || "";
        const description = doc.selectFirst("p.text-sm, p.text-gray-300, p.text-gray-400")?.text.trim() || "";

        const panneauRegex = /panneauAnime\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
        const seasons = [];
        let match;

        const cleanHtml = html.replace(/\/\*[\s\S]*?\*\//g, "");
        while ((match = panneauRegex.exec(cleanHtml)) !== null) {
            const seasonName = match[1];
            const seasonPath = match[2];
            if (!seasonPath.includes("scan")) {
                seasons.push({ name: seasonName, path: seasonPath });
            }
        }

        const chapters = [];

        for (const season of seasons) {
            const cleanPath = season.path.replace(/^\/+|\/+$/g, "");
            const epJsUrl = `${baseUrl}/${cleanPath}/episodes.js`;
            const epRes = await this.requestRes(epJsUrl);
            const epJs = epRes.body || "";
            if (!epJs || !epJs.includes("var eps")) continue;

            const arrays = {};
            const epsRegex = /var\s+(eps\d+)\s*=\s*\[([\s\S]*?)\];/g;
            let epsMatch;

            while ((epsMatch = epsRegex.exec(epJs)) !== null) {
                const key = epsMatch[1];
                const content = epsMatch[2];
                const urls = [];
                const urlRegex = /["'](https?:\/\/[^"']+)["']/g;
                let uMatch;
                while ((uMatch = urlRegex.exec(content)) !== null) {
                    urls.push(uMatch[1]);
                }
                arrays[key] = urls;
            }

            const keys = Object.keys(arrays);
            if (keys.length === 0) continue;

            const maxLen = Math.max(...keys.map(k => arrays[k].length));
            const langLabel = cleanPath.toUpperCase().includes("VF") ? "VF" : "VOSTFR";

            for (let i = 0; i < maxLen; i++) {
                const epLinks = [];
                for (const k of keys) {
                    if (arrays[k][i]) epLinks.push(arrays[k][i]);
                }
                if (epLinks.length > 0) {
                    chapters.push({
                        name: `${season.name} (${langLabel}) - Épisode ${i + 1}`,
                        url: JSON.stringify(epLinks)
                    });
                }
            }
        }

        return {
            name: name,
            imageUrl: imageUrl,
            description: description,
            episodes: chapters.reverse()
        };
    }

    async getVideoList(url) {
        let links = [];
        try {
            links = JSON.parse(url);
        } catch (e) {
            links = [url];
        }

        const videos = [];

        for (const link of links) {
            try {
                if (link.includes("sibnet.ru")) {
                    const res = await this.requestRes(link);
                    const html = res.body || "";
                    const m = html.match(/player\.src\(\[\{src:\s*["']([^"']+)["']/);
                    if (m) {
                        const vUrl = m[1].startsWith("http") ? m[1] : "https://video.sibnet.ru" + m[1];
                        videos.push({
                            url: vUrl,
                            originalUrl: vUrl,
                            quality: "Sibnet",
                            headers: { "Referer": "https://video.sibnet.ru/" }
                        });
                    }
                } else if (link.includes("sendvid.com")) {
                    const res = await this.requestRes(link);
                    const html = res.body || "";
                    const m = html.match(/var\s+video_source\s* = \s*["']([^"']+)["']/) || html.match(/<source\s+src=["']([^"']+)["']/);
                    if (m) {
                        videos.push({
                            url: m[1],
                            originalUrl: m[1],
                            quality: "Sendvid",
                            headers: { "Referer": "https://sendvid.com/" }
                        });
                    }
                } else if (link.includes("vidmoly")) {
                    const cleanLink = link.replace("vidmoly.to", "vidmoly.net");
                    const res = await this.requestRes(cleanLink);
                    const html = res.body || "";
                    const m = html.match(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
                    if (m) {
                        videos.push({
                            url: m[1],
                            originalUrl: m[1],
                            quality: "Vidmoly",
                            headers: { "Referer": "https://vidmoly.net/" }
                        });
                    }
                }
            } catch (err) {}
        }

        return videos;
    }
}
