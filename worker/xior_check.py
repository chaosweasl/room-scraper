import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time, urllib.request, json, os

URL = 'https://www.xiorstudenthousing.eu/netherlands/enschede/ariensplein-student-accommodation/'
ROOMS = ['Comfy', 'Comfy (balcony)']
WEBHOOK = os.environ.get('DISCORD_WEBHOOK_URL', '')

def discord(msg):
    if not WEBHOOK or 'your_discord' in WEBHOOK: return
    data = json.dumps({'content': msg}).encode()
    req = urllib.request.Request(WEBHOOK, data=data, headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req, timeout=5)

def check():
    options = uc.ChromeOptions()
    options.binary_location = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-blink-features=AutomationControlled')
    options.add_argument('--headless=new')
    options.add_argument('--user-data-dir=C:\\Users\\virtu\\AppData\\Local\\Temp\\uc-xior')

    driver = uc.Chrome(options=options, version_main=149)
    found = False
    try:
        driver.get(URL)
        time.sleep(4)

        # Accept cookies
        for btn in ['Accept All', 'Alles accepteren', 'Accepteren']:
            try:
                driver.find_element(By.XPATH, f"//*[contains(text(), '{btn}')]").click()
                time.sleep(1); break
            except: pass

        # Click "Check Availability" (opens booking modal)
        for text in ['Check Availability', 'Check availability', 'Find stay', 'Book']:
            try:
                el = driver.find_element(By.XPATH, f"//*[contains(text(), '{text}')]")
                driver.execute_script('arguments[0].scrollIntoView(true);', el)
                el.click()
                time.sleep(3)
                print(f'✅ Clicked "{text}"')
                break
            except: pass

        # Check for room types in the modal
        body = driver.find_element(By.TAG_NAME, 'body').text
        for room in ROOMS:
            if room.lower() in body.lower():
                print(f'🎉 {room}: AVAILABLE!')
                found = True
                discord(f'🚨 **XIOR ARIENSPLEIN — {room} AVAILABLE!**\n{URL}')
            else:
                print(f'❌ {room}: Not found (likely unavailable)')

        if not found:
            print('📭 No Xior rooms available')
    except Exception as e:
        print(f'❌ Xior check error: {e}')
    finally:
        driver.quit()
    return found

if __name__ == '__main__':
    check()
