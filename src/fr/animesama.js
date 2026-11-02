const mangayomiSources = [{
    "name": "Anime-Sama",
    "lang": "fr",
    "baseUrl": "https://anime-sama.to",
    "apiUrl": "",
    "iconUrl": "https://raw.githubusercontent.com/Mugi473/mangayomi-extensions/main/icons/animesama.png",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.0.0",
    "pkgPath": "src/fr/animesama.js"
}];

class DefaultExtension extends MProvider {
    getHeaders(url) {
        return {
            "Referer": this.source.baseUrl + "/",
            "User-Agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        };
    }

    async request(url) {
        const res = await new Client().get(url, this.getHeaders(url));
        return res.body;
    }

    parseCatalog(html) {
        const doc = new Document(html);
        const list = [];
        const cards = doc.select("div.shrink-0, div.catalogue-card, a[href*='/catalogue/']");
        const seen = new Set();

        for (const card of cards) {
            let linkEl = card.selectFirst("a[href*='/catalogue/']");
            let href = linkEl ? linkEl.attr("href") : card.attr("href");
            if (!href || !href.includes("/catalogue/")) continue;

            // Nettoyage de l'URL de base de l'oeuvre
            href = href.replace(/\/$/, "");
            if (href.startsWith("/")) href = this.source.baseUrl + href;
            if (seen.has(href)) continue;

            const imgEl = card.selectFirst("img");
            const titleEl = card.selectFirst("h1, h2, h3, p.font-semibold, .card-title");
            const name = titleEl ? titleEl.text.trim() : (imgEl ? imgEl.attr("alt").trim() : "");
            if (!name) continue;

            const imageUrl = imgEl ? imgEl.attr("src") : "";
            seen.add(href);
            list.push({
                name: name,
                link: href,
                imageUrl: imageUrl
            });
        }
        return {
            list: list,
            hasNextPage: list.length >= 20
        };
    }

    async getPopular(page) {
        const url = `${this.source.baseUrl}/catalogue/?type%5B%5D=Anime&page=${page}`;
        const html = await this.request(url);
        return this.parseCatalog(html);
    }

    async getLatestUpdates(page) {
        const url = `${this.source.baseUrl}/catalogue/?type%5B%5D=Anime&page=${page}`;
        const html = await this.request(url);
        return this.parseCatalog(html);
    }

    async search(query, page, filters) {
        const url = `${this.source.baseUrl}/catalogue/?type%5B%5D=Anime&search=${encodeURIComponent(query)}&page=${page}`;
        const html = await this.request(url);
        return this.parseCatalog(html);
    }

    async getDetail(url) {
        const baseUrl = url.startsWith("http") ? url : this.source.baseUrl + url;
        const html = await this.request(baseUrl);
        const doc = new Document(html);

        const name = doc.selectFirst("#titreOeuvre")?.text.trim() || "Anime";
        const imageUrl = doc.selectFirst("#coverOeuvre")?.attr("src") || "";
        const description = doc.selectFirst("p.text-sm.text-gray-300, p.text-gray-400")?.text.trim() || "";

        // Extraction des appels panneauAnime("Nom Saison", "dossier/langue")
        const panneauRegex = /panneauAnime\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
        const seasons = [];
        let match;

        // On ignore la section commentée dans le code source d'Anime-Sama
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
            // On tente VOSTFR et VF pour chaque saison trouvée
            const basePath = season.path.replace(/\/(vostfr|vf).*$/i, "");
            const langs = ["vostfr", "vf"];

            for (const lang of langs) {
                const epJsUrl = `${baseUrl}/${basePath}/${lang}/episodes.js`;
                const epJs = await this.request(epJsUrl);
                if (!epJs || !epJs.includes("var eps")) continue;

                // Découpage par tableau eps1, eps2, eps3...
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
                for (let i = 0; i < maxLen; i++) {
                    const epLinks = [];
                    for (const k of keys) {
                        if (arrays[k][i]) epLinks.push(arrays[k][i]);
                    }
                    if (epLinks.length > 0) {
                        chapters.push({
                            name: `${season.name} (${lang.toUpperCase()}) - Épisode ${i + 1}`,
                            url: JSON.stringify(epLinks)
                        });
                    }
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
                    const html = await this.request(link);
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
                    const html = await this.request(link);
                    const m = html.match(/var\s+video_source\s*=\s*["']([^"']+)["']/) || html.match(/<source\s+src=["']([^"']+)["']/);
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
                    const html = await this.request(cleanLink);
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
            } catch (err) {
                // Ignore un lecteur mort et passe au suivant
            }
        }

        return videos;
    }
}
