const fs = require('fs');
const sharp = require('sharp');

// ===== CẤU HÌNH =====
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const PLAYER_NAME = process.env.PLAYER_NAME || 'USER POODLE';
const RAP_API_URL = 'https://ps99.biggamesapi.io/api/rap';
const PETS_API_URL = 'https://ps99.biggamesapi.io/api/collection/Pets';
const SHINY_RATE = 0.05; // 1/20 = 5%

if (!WEBHOOK_URL || WEBHOOK_URL === 'https://discord.com/api/webhooks/...') {
    console.error('❌ Vui lòng đặt WEBHOOK_URL trong env hoặc sửa trực tiếp trong script');
    process.exit(1);
}

// ===== ĐỊNH NGHĨA TỶ LỆ =====
const RARITY_WEIGHTS = { Huge: 50, Titanic: 1 };
const BASE_VARIANT_WEIGHTS = {
    Normal: 20,
    Golden: 4,
    Rainbow: 2
};

// ===== HÀM TIỆN ÍCH =====
function formatGemValue(value) {
    if (value === undefined || value === null) return 'N/A';
    const num = Number(value);
    if (isNaN(num)) return 'N/A';
    const suffixes = ["", "K", "M", "B", "T", "Qd", "Qn"];
    let index = 0;
    let tempNum = num;
    while (tempNum >= 1000 && index < suffixes.length - 1) {
        tempNum /= 1000;
        index++;
    }
    if (index === 0) return Math.floor(tempNum).toString();
    else return Math.floor(tempNum) + suffixes[index];
}

function getImageUrlFromAssetId(assetId) {
    if (!assetId) return null;
    const match = assetId.match(/\d+/);
    return match ? `https://biggamesapi.io/image/${match[0]}` : null;
}

// ===== LẤY DỮ LIỆU API =====
let rapMap = new Map();
let petsMap = new Map();

async function fetchAndStoreRAP() {
    console.log('🔄 Đang tải dữ liệu RAP...');
    try {
        const res = await fetch(RAP_API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== 'ok' || !data.data) throw new Error('Invalid API response');
        let count = 0;
        for (const item of data.data) {
            if (item.category === 'Pet') {
                const petId = item.configData.id;
                const pt = item.configData.pt !== undefined ? item.configData.pt : 0;
                const shiny = item.configData.sh === true;
                const key = `${petId}|${pt}|${shiny}`;
                rapMap.set(key, item.value);
                count++;
            }
        }
        console.log(`✅ Đã tải RAP cho ${count} pet.`);
    } catch (err) {
        console.error('❌ Lỗi tải RAP:', err.message);
    }
}

async function fetchAndStorePets() {
    console.log('🔄 Đang tải dữ liệu Pet...');
    try {
        const res = await fetch(PETS_API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== 'ok' || !data.data) throw new Error('Invalid API response');
        let count = 0;
        for (const pet of data.data) {
            if (pet.configName) {
                petsMap.set(pet.configName, pet);
                count++;
            }
        }
        console.log(`✅ Đã tải dữ liệu cho ${count} pet.`);
    } catch (err) {
        console.error('❌ Lỗi tải Pet:', err.message);
    }
}

function getRAPForPet(petName, baseVariant, isShiny) {
    let pt = 0;
    const v = baseVariant.toLowerCase();
    if (v === 'golden') pt = 1;
    else if (v === 'rainbow') pt = 2;
    const key = `${petName}|${pt}|${isShiny}`;
    let rap = rapMap.get(key);
    if (rap !== undefined) return rap;
    // Fallback: không shiny
    if (isShiny) {
        const fallbackKey = `${petName}|${pt}|false`;
        rap = rapMap.get(fallbackKey);
        if (rap !== undefined) return rap;
    }
    // Fallback: normal không shiny
    const normalKey = `${petName}|0|false`;
    rap = rapMap.get(normalKey);
    return rap !== undefined ? rap : null;
}

async function getThumbnailForPet(petName, baseVariant, isShiny) {
    const petData = petsMap.get(petName);
    if (!petData) return null;
    const config = petData.configData;
    let assetId = null;
    const v = baseVariant.toLowerCase();
    if (isShiny && config.shinyThumbnail) {
        assetId = config.shinyThumbnail;
    } else if (v === 'golden' && config.goldenThumbnail) {
        assetId = config.goldenThumbnail;
    } else {
        assetId = config.thumbnail;
    }
    return assetId ? getImageUrlFromAssetId(assetId) : null;
}

async function createRainbowImage(imageUrl) {
    try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) throw new Error(`Fetch image failed: ${imgRes.status}`);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const metadata = await sharp(imgBuffer).metadata();
        const width = metadata.width;
        const height = metadata.height;
        const gradientSvg = Buffer.from(`
            <svg width="${width}" height="${height}">
                <defs>
                    <linearGradient id="rainbow" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#ff0000" stop-opacity="0.5"/>
                        <stop offset="16%" stop-color="#ffff00" stop-opacity="0.5"/>
                        <stop offset="33%" stop-color="#00ff00" stop-opacity="0.5"/>
                        <stop offset="50%" stop-color="#00ffff" stop-opacity="0.5"/>
                        <stop offset="66%" stop-color="#0000ff" stop-opacity="0.5"/>
                        <stop offset="83%" stop-color="#ff00ff" stop-opacity="0.5"/>
                        <stop offset="100%" stop-color="#ff0000" stop-opacity="0.5"/>
                    </linearGradient>
                </defs>
                <rect width="${width}" height="${height}" fill="url(#rainbow)"/>
            </svg>
        `);
        const finalBuffer = await sharp(imgBuffer)
            .composite([{ input: gradientSvg, blend: 'overlay' }])
            .png()
            .toBuffer();
        return finalBuffer;
    } catch (err) {
        console.error('❌ Lỗi tạo ảnh rainbow:', err);
        return null;
    }
}

async function createShinyEffect(imageUrl) {
    try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) throw new Error(`Fetch image failed: ${imgRes.status}`);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const metadata = await sharp(imgBuffer).metadata();
        const width = metadata.width;
        const height = metadata.height;
        const sparkleSvg = Buffer.from(`
            <svg width="${width}" height="${height}">
                <defs>
                    <radialGradient id="glint" cx="30%" cy="30%" r="50%">
                        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.7"/>
                        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
                    </radialGradient>
                </defs>
                <rect width="${width}" height="${height}" fill="url(#glint)"/>
            </svg>
        `);
        const finalBuffer = await sharp(imgBuffer)
            .composite([{ input: sparkleSvg, blend: 'screen' }])
            .png()
            .toBuffer();
        return finalBuffer;
    } catch (err) {
        console.error('❌ Lỗi tạo ảnh shiny:', err);
        return null;
    }
}

// ===== ĐỌC DANH SÁCH PET =====
let hugeList = [];
try {
    const raw = fs.readFileSync('huge-list.json', 'utf8');
    hugeList = JSON.parse(raw);
    if (!Array.isArray(hugeList) || hugeList.length === 0) throw new Error('Empty list');
} catch (err) {
    console.error('❌ Lỗi đọc huge-list.json:', err.message);
    process.exit(1);
}

function getRandomPetWithVariant() {
    // Bước 1: Chọn pet dựa trên type weight (Huge/Titanic)
    let petCandidates = [];
    for (const pet of hugeList) {
        const typeWeight = RARITY_WEIGHTS[pet.type] || 0;
        if (typeWeight > 0) petCandidates.push({ pet, weight: typeWeight });
    }
    if (petCandidates.length === 0) return null;
    let totalTypeWeight = petCandidates.reduce((s, c) => s + c.weight, 0);
    let rand = Math.random() * totalTypeWeight;
    let selectedPet = null;
    for (const c of petCandidates) {
        if (rand < c.weight) {
            selectedPet = c.pet;
            break;
        }
        rand -= c.weight;
    }
    if (!selectedPet) return null;

    // Bước 2: Chọn base variant (Normal/Golden/Rainbow)
    let totalVariantWeight = Object.values(BASE_VARIANT_WEIGHTS).reduce((a, b) => a + b, 0);
    rand = Math.random() * totalVariantWeight;
    let baseVariant = null;
    for (const [variant, weight] of Object.entries(BASE_VARIANT_WEIGHTS)) {
        if (rand < weight) {
            baseVariant = variant;
            break;
        }
        rand -= weight;
    }
    if (!baseVariant) baseVariant = "Normal";

    // Bước 3: Quyết định shiny (5%)
    const isShiny = Math.random() < SHINY_RATE;
    const finalVariant = isShiny ? `Shiny ${baseVariant}` : baseVariant;

    return {
        name: selectedPet.name,
        type: selectedPet.type,
        variant: finalVariant,
        baseVariant: baseVariant,
        isShiny: isShiny
    };
}

// ===== TẠO EMBED =====
async function buildEmbed(pet) {
    const { name: petName, type: petType, variant: fullVariant, baseVariant, isShiny } = pet;
    const now = new Date();
    const timestamp = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const rapValue = getRAPForPet(petName, baseVariant, isShiny);
    const formattedRap = rapValue !== null ? `${formatGemValue(rapValue)} 💎` : 'N/A 💎';

    let thumbnailUrl = await getThumbnailForPet(petName, baseVariant, isShiny);
    let finalImageBuffer = null;

    if (thumbnailUrl) {
        if (baseVariant === 'Rainbow') {
            finalImageBuffer = await createRainbowImage(thumbnailUrl);
        } else if (isShiny) {
            finalImageBuffer = await createShinyEffect(thumbnailUrl);
        }
        if (finalImageBuffer) {
            const formData = new FormData();
            formData.append('file', new Blob([finalImageBuffer]), `${fullVariant}_${petName}.png`);
            const uploadRes = await fetch('https://discord.com/api/v10/webhooks/attachments', {
                method: 'POST',
                headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}` },
                body: formData
            });
            if (uploadRes.ok) {
                const uploadData = await uploadRes.json();
                thumbnailUrl = uploadData.attachments[0].url;
            } else {
                console.error(`❌ Upload ảnh thất bại:`, uploadRes.status);
            }
        }
    }

    const embed = {
        title: petType === 'Titanic' ? '✨ TITANIC HATCHED!' : '🎉 HUGE HATCHED!',
        description: `Someone just hatched a **${fullVariant} ${petName}**!`,
        color: petType === 'Titanic' ? 0xFF0000 : 0xFFD700,
        fields: [
            { name: '🐾 Pet', value: `\`\`\`${fullVariant} ${petName}\`\`\``, inline: true },
            { name: '👤 Player', value: `\`\`\`${PLAYER_NAME}\`\`\``, inline: true },
            { name: '💰 RAP', value: `\`\`\`${formattedRap}\`\`\``, inline: true }
        ],
        footer: {
            text: `Poodle RNG Huge Tracker  • ${timestamp}`,
            icon_url: 'https://cdn.discordapp.com/emojis/1487028036049305611.webp'
        }
    };
    if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
    return { embeds: [embed] };
}

async function sendWebhook() {
    const pet = getRandomPetWithVariant();
    if (!pet) return;
    console.log(`✨ Chọn: ${pet.type} ${pet.variant} ${pet.name}`);
    const payload = await buildEmbed(pet);
    const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res.ok) console.log('✅ Đã gửi');
    else console.error(`❌ Lỗi ${res.status}: ${await res.text()}`);
}

async function runLoop() {
    await Promise.all([fetchAndStoreRAP(), fetchAndStorePets()]);
    console.log('🔄 Bắt đầu gửi webhook mỗi 1-4 phút với tỷ lệ:');
    console.log(`   - Huge:Titanic = ${RARITY_WEIGHTS.Huge}:${RARITY_WEIGHTS.Titanic}`);
    console.log(`   - Base variants: Normal:20, Golden:4, Rainbow:2`);
    console.log(`   - Shiny rate: ${SHINY_RATE * 100}% (chồng lên variant)`);
    while (true) {
        try {
            await sendWebhook();
        } catch (err) {
            console.error('Lỗi gửi:', err.message);
        }
        const delay = Math.floor(Math.random() * (400000 - 300000 + 1) + 300000);
        console.log(`😴 Chờ ${(delay / 60000).toFixed(1)} phút...`);
        await new Promise(r => setTimeout(r, delay));
    }
}

runLoop().catch(console.error);