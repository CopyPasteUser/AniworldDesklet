const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;

function AniWorldDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

AniWorldDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        this._metadata = metadata;
        this._currentIndex = 0;
        this._uniqueAnimeList = [];
        this._imagesPath = this._metadata.path + "/images";

        GLib.mkdir_with_parents(this._imagesPath, 0o755);

        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);
        this._buildUI();
        this.setContent(this.container);
        this._loadJsonData();

        Mainloop.timeout_add_seconds(300, () => {
            this._loadJsonData();
            return true;
        });
    },

    _buildUI: function() {
        this.container = new St.BoxLayout({ vertical: true, style_class: "container", x_align: Clutter.ActorAlign.FILL });

        this.openButton = new St.Button({ style_class: "button", x_expand: true, x_align: Clutter.ActorAlign.FILL });
        let buttonLabel = new St.Label({ text: "🌐 Open AniWorld", style_class: "button-label", x_expand: true });
        this.openButton.set_child(buttonLabel);
        this.openButton.connect("clicked", () => this._launchBrowserFocused("https://aniworld.to"));
        this.container.add_child(this.openButton);

        this.seriesTitle = new St.Label({ text: "Lade Serie...", style_class: "title", x_align: Clutter.ActorAlign.CENTER });
        this.container.add_child(this.seriesTitle);

        let imageRow = new St.BoxLayout({ vertical: false, x_align: Clutter.ActorAlign.CENTER });
        this.leftArrow = new St.Button({ label: "←", style_class: "button arrow" });
        this.rightArrow = new St.Button({ label: "→", style_class: "button arrow" });

        this.seriesImage = new St.Bin({ width: 120, height: 180, style_class: "series-image" });
        this.imageButton = new St.Button({ child: this.seriesImage, style_class: "image-button" });
        this.imageButton.connect("clicked", () => this._openCurrentEpisode());

        this.leftArrow.connect("clicked", () => this._switchAnime(-1));
        this.rightArrow.connect("clicked", () => this._switchAnime(1));

        imageRow.add_child(this.leftArrow);
        imageRow.add_child(this.imageButton);
        imageRow.add_child(this.rightArrow);
        this.container.add_child(imageRow);

        this.episodeTitle = new St.Label({ text: "Lade Episode...", style_class: "item", x_align: Clutter.ActorAlign.CENTER });
        this.container.add_child(this.episodeTitle);
    },

    _loadJsonData: function() {
        let filePath = this._metadata.path + "/recentAniworldFetch.json";
        try {
            let [success, contents] = GLib.file_get_contents(filePath);
            if (!success) {
                global.log("❌ Konnte recentAniworldFetch.json nicht lesen");
                return;
            }

            let jsonString = ByteArray.toString(contents);
            let rawList = JSON.parse(jsonString);

            let seen = new Set();
            this._uniqueAnimeList = rawList.filter(item => {
                if (!item.titel) return false;
                let t = item.titel.toLowerCase();
                if (seen.has(t)) return false;
                seen.add(t);
                return true;
            });

            this._cleanupUnusedImages();

            if (this._uniqueAnimeList.length === 0) {
                this.seriesTitle.set_text("Keine Daten gefunden");
                return;
            }

            this._showAnime(this._currentIndex);

        } catch (e) {
            global.log("❌ Fehler beim Laden oder Parsen: " + e);
        }
    },

    _sanitizeFilename: function(name) {
        return name.replace(/[^\w.-]+/g, "_");
    },

        _showAnime: function(index) {
        if (index < 0 || index >= this._uniqueAnimeList.length) return;
        this._currentIndex = index;
        let anime = this._uniqueAnimeList[index];

        this.seriesTitle.set_text(anime.titel);
        this.episodeTitle.set_text(`${anime.staffel} - ${anime.episode}`);
        this._currentEpisodeLink = anime.link || null;

        if (!anime.bild || !anime.bild.startsWith("http")) {
            this.seriesImage.set_child(null);
            return;
        }

        let filename = this._sanitizeFilename(anime.titel) + ".jpg";
        let imagePath = this._imagesPath + "/" + filename;
        let file = Gio.File.new_for_path(imagePath);

        const setImage = () => {
            const TextureCache = St.TextureCache.get_default();
            let texture = TextureCache.load_uri_async("file://" + imagePath, 120, 180);
            this.seriesImage.set_child(texture);
        };

        if (file.query_exists(null)) {
            setImage();
        } else {
            // 📥 Download mit wget und Browser-User-Agent
            let userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
            let cmd = `wget --timeout=10 --user-agent="${userAgent}" -O "${imagePath}" "${anime.bild}"`;

            GLib.spawn_command_line_async(cmd);

            // ⏳ Warte 1 Sekunde, dann versuche das Bild zu setzen
            Mainloop.timeout_add(1000, () => {
                if (file.query_exists(null)) setImage();
                return false;
            });
        }
    },


    _switchAnime: function(direction) {
        let newIndex = this._currentIndex + direction;
        if (newIndex < 0) newIndex = this._uniqueAnimeList.length - 1;
        if (newIndex >= this._uniqueAnimeList.length) newIndex = 0;
        this._showAnime(newIndex);
    },

    _openCurrentEpisode: function() {
        if (this._currentEpisodeLink) {
            this._launchBrowserFocused(this._currentEpisodeLink);
        }
    },

    _launchBrowserFocused: function(url) {
        const browsers = [
            "firefox", "google-chrome", "chromium", "brave-browser", "microsoft-edge", "opera"
        ];

        for (let cmd of browsers) {
            let browserPath = GLib.find_program_in_path(cmd);
            if (browserPath) {
                GLib.spawn_command_line_async(`${cmd} "${url}"`);
                Mainloop.timeout_add(500, () => {
                    let windowName = {
                        "firefox": "Mozilla Firefox",
                        "google-chrome": "Chrome",
                        "chromium": "Chrome",
                        "brave-browser": "Chrome",
                        "microsoft-edge": "Edge",
                        "opera": "Opera"
                    }[cmd];
                    if (windowName) {
                        GLib.spawn_command_line_async(`wmctrl -a "${windowName}"`);
                    }
                    return false;
                });
                return;
            }
        }

        GLib.spawn_command_line_async(`xdg-open "${url}"`);
    },

    _cleanupUnusedImages: function() {
        let usedFiles = new Set(this._uniqueAnimeList.map(anime => this._sanitizeFilename(anime.titel) + ".jpg"));
        try {
            let dirFile = Gio.File.new_for_path(this._imagesPath);
            if (dirFile.query_exists(null)) {
                let enumerator = dirFile.enumerate_children("standard::*", Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    let filename = info.get_name();
                    if (!usedFiles.has(filename)) {
                        try {
                            dirFile.get_child(filename).delete(null);
                        } catch (e) {
                            global.log("❌ Fehler beim Löschen von Bild: " + filename);
                        }
                    }
                }
            }
        } catch (e) {
            global.log("❌ Fehler beim Bereinigen des Bildordners: " + e);
        }
    }
};

function main(metadata, desklet_id) {
    return new AniWorldDesklet(metadata, desklet_id);
}
