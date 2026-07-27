const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const { alldown } = require("rx-dawonload");

module.exports.config = {
    name: "autodl",
    version: "2.2.0",
    credits: "rX",
    hasPermission: 0,
    description: "Auto detect any link and ask for download confirm",
    usePrefix: true,
    commandCategory: "utility",
    usages: "[on/off]",
    cooldowns: 2
};

// -------------------------
// 💾 Storage helpers (per-thread on/off, default OFF)
// -------------------------
const dataDir = path.join(__dirname, "cache");
const dataFile = path.join(dataDir, "autodl_status.json");

function loadStatus() {
    try {
        fs.ensureDirSync(dataDir);
        if (!fs.existsSync(dataFile)) {
            fs.writeJsonSync(dataFile, {});
            return {};
        }
        return fs.readJsonSync(dataFile);
    } catch (e) {
        console.log("autodl loadStatus error:", e);
        return {};
    }
}

function saveStatus(statusObj) {
    try {
        fs.ensureDirSync(dataDir);
        fs.writeJsonSync(dataFile, statusObj, { spaces: 2 });
    } catch (e) {
        console.log("autodl saveStatus error:", e);
    }
}

// Default OFF -> only true means enabled
function isEnabled(threadID) {
    const status = loadStatus();
    return status[threadID] === true;
}

// -------------------------
// ⚙️ Command: autodl on / off
// -------------------------
module.exports.run = async function ({ api, event, args }) {
    const threadID = event.threadID;
    const mode = (args[0] || "").toLowerCase();

    if (!["on", "off"].includes(mode)) {
        const current = isEnabled(threadID) ? "ON ✅" : "OFF ❌";
        return api.sendMessage(
            `⚙️ Autodl current status: ${current}\n\nUsage:\n➜ autodl on\n➜ autodl off`,
            threadID
        );
    }

    const status = loadStatus();
    status[threadID] = mode === "on";
    saveStatus(status);

    return api.sendMessage(
        mode === "on"
            ? "✅ Autodl has been enabled for this thread."
            : "❌ Autodl has been disabled for this thread.",
        threadID
    );
};

// -------------------------
// 🔥 Auto Detect Link (Only: FB, Insta, TikTok, YouTube, Pinterest)
// -------------------------
module.exports.handleEvent = async function ({ api, event }) {
    const threadID = event.threadID;

    // Default OFF: skip if not enabled for this thread
    if (!isEnabled(threadID)) return;

    const content = event.body ? event.body.trim() : "";
    if (!content.startsWith("http")) return;

    // Detect Platform (only supported ones)
    let site = null;
    if (content.includes("youtube.com") || content.includes("youtu.be")) site = "YouTube";
    else if (content.includes("tiktok.com")) site = "TikTok";
    else if (content.includes("instagram.com")) site = "Instagram";
    else if (content.includes("facebook.com") || content.includes("fb.watch")) site = "Facebook";
    else if (content.includes("pinterest.com") || content.includes("pin.it")) site = "Pinterest";

    // Not a supported platform -> ignore silently
    if (!site) return;

    // Ask for confirmation
    api.sendMessage(
        `🔍 Platform detected: ${site}\n\n❮ React ❤ this message to start download ❯.`,
        threadID,
        (err, info) => {
            if (err) return;

            // Register Reaction Listener
            global.client.handleReaction = global.client.handleReaction || [];
            global.client.handleReaction.push({
                type: "autodl_confirm",
                name: module.exports.config.name,
                messageID: info.messageID,
                author: event.senderID,
                url: content,
                site
            });
        }
    );
};

// -------------------------
// ❤️ Reaction Handler
// -------------------------
module.exports.handleReaction = async function ({ api, event, handleReaction }) {
    try {
        if (handleReaction.type !== "autodl_confirm") return;

        // Anyone can react now
        const reaction = event.reaction;
        if (reaction !== "❤") return;

        // Edit confirmation message to show downloading
        api.editMessage(`⬇️ Downloading...`, handleReaction.messageID);

        const videoURL = handleReaction.url;
        const site = handleReaction.site;

        // Download using alldown
        const data = await alldown(videoURL);
        if (!data || !data.url) {
            api.sendMessage(`❌ Failed to fetch download link!`, event.threadID);
            return;
        }

        const title = data.title || "video";
        const dlUrl = data.url;

        // Download buffer
        const buffer = (await axios.get(dlUrl, { responseType: "arraybuffer" })).data;
        const safeTitle = title.replace(/[^\w\s]/gi, "_");

        const cacheDir = path.join(__dirname, "cache");
        fs.ensureDirSync(cacheDir);
        const filePath = path.join(cacheDir, `${safeTitle}.mp4`);
        fs.writeFileSync(filePath, buffer);

        // Send downloaded file
        api.sendMessage(
            {
                body: `🎀 Download Complete!\n📍 Platform: ${site}\n🎬 Title: ${title}`,
                attachment: fs.createReadStream(filePath)
            },
            event.threadID,
            () => {
                fs.unlinkSync(filePath);
                // Remove the "Downloading" message
                api.unsendMessage(handleReaction.messageID);
            }
        );

    } catch (e) {
        console.log("autodl reaction error:", e);
        api.sendMessage("❌ Download failed!", event.threadID);
    }
};
