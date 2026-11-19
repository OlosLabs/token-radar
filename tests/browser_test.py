"""Exercise real generated snapshot data and capture authentic competition images."""
import functools
import http.server
import json
import pathlib
import subprocess
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT.parent / 'kit/token-radar-01-kit/input/snapshot.json'

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    with tempfile.TemporaryDirectory(prefix='fieldbook-browser-') as temporary:
        out = pathlib.Path(temporary)
        subprocess.run(['node', str(ROOT / 'main.ts'), '--input', str(SNAPSHOT), '--output', str(out)], check=True)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f'http://127.0.0.1:{server.server_port}'
        errors, external = [], []
        checks = []
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
            context = browser.new_context(viewport={'width':1440,'height':900}, device_scale_factor=1)
            def route(request):
                if request.request.url.startswith(origin + '/'):
                    request.continue_()
                else:
                    external.append(request.request.url)
                    request.abort()
            context.route('**/*', route)
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.goto(origin + '/dashboard/')
            page.wait_for_selector('#fieldbook:not([hidden])')
            assert page.locator('.table tbody tr').count() == 10
            assert '40/40' in page.locator('#coverage').inner_text()
            complete_rows = page.locator('.table tbody tr').evaluate_all('(rows)=>rows.filter(r=>{const b=r.getBoundingClientRect();return b.top>=0 && b.bottom<=innerHeight}).length')
            assert complete_rows >= 5, complete_rows
            page.keyboard.press('Tab')
            assert page.locator('.skip').evaluate('(e)=>e===document.activeElement')
            page.keyboard.press('Enter')
            assert page.locator('#board').evaluate('(e)=>e===document.activeElement')
            page.evaluate('window.scrollTo(0,0)')
            page.screenshot(path=str(ROOT/'screenshots/1-board.jpg'), type='jpeg', quality=72)
            checks.append(f'desktop board, watchlist coverage, keyboard skip and {complete_rows} complete rows at 1440x900')
            page.locator('[data-open="steakhouse-financial"]').click()
            assert page.locator('#dossier').evaluate('(d)=>d.open')
            assert page.locator('#dossier-title').inner_text() == 'Steakhouse Financial'
            page.screenshot(path=str(ROOT/'screenshots/2-detail.jpg'), type='jpeg', quality=72)
            page.keyboard.press('Escape')
            assert not page.locator('#dossier').evaluate('(d)=>d.open')
            assert page.locator('[data-open="steakhouse-financial"]').evaluate('(e)=>e===document.activeElement')
            checks.append('native dialog, Escape and focus return')
            for selector in ['steakhouse-financial','sentora-curator','veda','gauntlet']:
                page.locator(f'#table [data-compare="{selector}"]').click()
            assert page.locator('.compare-card').count() == 3
            assert 'full' in page.locator('#compare-status').inner_text()
            page.locator('#comparison [data-compare="veda"]').click()
            assert page.locator('.compare-card').count() == 2
            checks.append('compare cap, removal and persistent selection')
            page.locator('#assumptions summary').click()
            page.locator('#s-whatif').fill('1')
            page.locator('#s-pool').fill('1000000')
            page.locator('#s-deposits').fill('10000000')
            before = page.locator('#compare-grid').inner_text()
            page.locator('#s-fixed').fill('100')
            assert page.locator('#compare-grid').inner_text() != before
            page.locator('#s-capital').fill('-1')
            assert page.locator('#invalid').is_visible()
            page.locator('#s-capital').fill('250')
            assert not page.locator('#invalid').is_visible()
            page.locator('#s-fixed').fill('2')
            page.locator('#assumptions summary').click()
            expected = page.evaluate('FarmScenario.economics(FIELD.rows[0],Object.fromEntries(FarmScenario.fields.map(([k])=>[k,Number(document.getElementById("s-"+k).value)])))')
            expected_text = f'${expected["expectedNet"]:,.2f}' if expected['expectedNet'] >= 0 else f'-${abs(expected["expectedNet"]):,.2f}'
            assert expected_text in page.locator('#table .farm').first.inner_text()
            assert expected_text in page.locator('#compare-grid').inner_text()
            page.locator('[data-open="steakhouse-financial"]').click()
            assert expected_text in page.locator('#detail').inner_text()
            assert page.locator('#detail .sensitivity tbody tr').count() == 3
            assert 'Reward-pool sensitivity' in page.locator('#detail').inner_text()
            page.keyboard.press('Escape')
            checks.append('shared scenario propagation and invalid-input retention')
            page.locator('#search').fill('not-a-protocol-zzzz')
            assert 'No candidates match' in page.locator('#table').inner_text()
            page.locator('[data-clear]').click()
            page.locator('#category').select_option('Lending')
            page.locator('#sort').select_option('tvl')
            assert page.locator('.table tbody tr').count() > 0
            assert 'Lending' in page.locator('.table tbody tr').first.inner_text()
            page.locator('#assumptions summary').click()
            page.locator('#s-whatif').fill('0')
            page.locator('#assumptions summary').click()
            page.locator('#verdict').select_option('FARM')
            farm_rows = page.locator('.table tbody tr').count()
            assert farm_rows > 0
            assert 'FARM' in page.locator('.table tbody tr').first.inner_text()
            page.locator('#verdict').select_option('')
            page.locator('#sort').select_option('net')
            assert page.locator('.table tbody tr').count() == 10
            page.locator('#sort').select_option('rank')
            assert 'board.json' in page.locator('#audit').inner_text()
            assert '40/40' in page.locator('#audit').inner_text()
            page.evaluate('window.scrollTo(0,0)')
            page.screenshot(path=str(ROOT/'screenshots/3-filtered.jpg'), type='jpeg', quality=72)
            checks.append('empty state, clear, sector filter, verdict filter, net sort and self-audit strip')
            for width in [390, 320, 768]:
                page.set_viewport_size({'width':width,'height':844})
                page.locator('#category').select_option('')
                page.locator('#search').fill('curvance')
                assert page.locator('.table tbody tr').count() == 1
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.locator('#table [data-open]').click()
                assert page.locator('#dossier').evaluate('(d)=>d.open')
                assert page.locator('#dossier').evaluate('(d)=>d.scrollWidth<=d.clientWidth')
                page.keyboard.press('Escape')
                page.locator('#evidence details summary').click()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.locator('#evidence details summary').click()
                page.locator('#search').fill('')
                page.locator('#chain').select_option('Base')
                page.locator('#sort').select_option('growth')
                assert page.locator('.table tbody tr').count() > 0
                page.locator('#chain').select_option('')
            checks.append('mobile 320/390 and tablet 768 search, filters, sort, dossier and no overflow')
            # Every real candidate is reachable through the actual search and dossier controls.
            page.set_viewport_size({'width':1440,'height':900})
            data = json.loads((out/'board.json').read_text())
            for row in data['rows']:
                page.locator('#search').fill(row['slug'])
                page.locator(f'[data-open="{row["slug"]}"]').click()
                assert page.locator('#dossier-title').inner_text() == row['name']
                assert page.locator('.timeline li').count() == len(row['farm_steps'])
                page.keyboard.press('Escape')
            checks.append(f'all {len(data["rows"])} real protocol dossiers')
            file_page = context.new_page()
            file_page.on('pageerror', lambda e: errors.append(str(e)))
            file_page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            # A true disconnected context still renders data via local scripts.
            context.unroute('**/*')
            context.set_offline(True)
            file_page.goto((out/'dashboard/index.html').as_uri())
            assert file_page.locator('.table tbody tr').count() == 10
            checks.append('file:// rendering with network offline')
            assert not errors, errors
            assert not external, external
            browser.close()
        server.shutdown()
        for image in ROOT.joinpath('screenshots').glob('*.png'):
            image.unlink()  # remove explicitly superseded starter captures only
        from PIL import Image
        dimensions = {p.name:Image.open(p).size for p in ROOT.joinpath('screenshots').glob('*.jpg')}
        assert all(size == (1440, 900) for size in dimensions.values())
        report = {'checks':checks, 'complete_desktop_rows':complete_rows, 'screenshot_dimensions':dimensions, 'javascript_errors':errors, 'external_requests':external,
                  'screenshots':{p.name:p.stat().st_size for p in ROOT.joinpath('screenshots').glob('*.jpg')}}
        for size in report['screenshots'].values():
            assert size < 512*1024
        ROOT.joinpath('tests/browser-results.json').write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
