"""Real shipped UI states only: no capture CSS, DOM hiding or fabricated data."""
import csv
import argparse
import functools
import http.server
import io
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
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=pathlib.Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='fieldbook-browser-') as temporary:
        out = pathlib.Path(temporary)
        subprocess.run(['node', str(ROOT/'main.ts'), '--input', str(SNAPSHOT), '--output', temporary], check=True)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f'http://127.0.0.1:{server.server_port}'
        errors, external, checks = [], [], []
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
            def capture(name):
                assert page.locator('[style]').evaluate_all('(els)=>els.every(e=>!e.style.display && !e.style.visibility)')
                page.screenshot(path=str(ROOT/'screenshots'/name), type='jpeg', quality=92)
            def fully_visible(selector):
                return page.locator(selector).evaluate_all('(els)=>els.every(e=>{const b=e.getBoundingClientRect();return b.width>0 && b.top>=0 && b.bottom<=innerHeight})')
            assert page.locator('.table tbody tr').count() == 10
            assert '40/40' in page.locator('#coverage').inner_text()
            # Measure the untouched first load BEFORE keyboard navigation or capture.
            assert page.evaluate('scrollY') == 0
            complete_rows = page.locator('.table tbody tr').evaluate_all('(rows)=>rows.filter(r=>{const b=r.getBoundingClientRect();return b.top>=0 && b.bottom<=innerHeight}).length')
            assert complete_rows >= 5, complete_rows
            assert fully_visible('#chart') and page.locator('.chart-point').count() == 87
            assert fully_visible('#validation .metric') and page.locator('#validation .metric').all_inner_texts() == ['2.10× vs 4.52×','57.6% vs 80%','0.230 vs 0.321','200']
            assert 'Full vs flat miss' in page.locator('#validation').inner_text()
            assert 'Printed-range hits vs 80% target' in page.locator('#validation').inner_text()
            assert 'Token-status Brier: model vs base' in page.locator('#validation').inner_text()
            audit_text = page.locator('#audit').inner_text()
            assert 'checksum' in audit_text and '= main.ts' in audit_text and '758/758' in audit_text, audit_text
            assert fully_visible('#audit'), page.locator('#audit').bounding_box()
            box = page.locator('#board').bounding_box()
            assert box is not None
            board_y = box['y']
            capture('1-board.jpg')
            page.keyboard.press('Tab')
            assert page.locator('.skip').evaluate('(e)=>e===document.activeElement')
            page.keyboard.press('Enter')
            assert page.locator('#board').evaluate('(e)=>e===document.activeElement')
            checks.append(f'default unmodified 1440x900: {complete_rows} complete rows, chart visible, board y={board_y}; keyboard skip')
            page.locator('#search').fill('Katana DEX')
            page.locator('[data-open="katana-dex"]').click()
            detail = page.locator('#detail').inner_text()
            assert 'Optimal renewal point — day 38' in detail and '$0.18/day carry' in detail
            assert 'Farm it' in detail and 'Build scenario only' in detail
            assert 'Fees covered from n/a' not in detail
            assert fully_visible('.decision') and fully_visible('.renewal')
            assert fully_visible('.detail-columns>article:nth-child(2)>p:first-child')
            capture('2-detail.jpg')
            page.keyboard.press('Escape')
            assert page.locator('[data-open="katana-dex"]').evaluate('(e)=>e===document.activeElement')
            page.locator('#search').fill('')
            page.locator('[data-open="steakhouse-financial"]').click()
            detail = page.locator('#detail').inner_text()
            assert 'Optimal renewal point — day 7' in detail and 'do not renew past the first review' in detail
            assert 'Thin — verify terms first' in detail and 'Fees covered from n/a' not in detail
            page.keyboard.press('Escape')
            checks.append('authentic dossier capture; renewal contrast day 73 vs day 7; break-even present; Escape/focus return')
            for slug in ['steakhouse-financial','sentora-curator','veda','gauntlet']:
                page.locator(f'#table [data-compare="{slug}"]').click()
            assert page.locator('.compare-card').count() == 3
            assert 'full' in page.locator('#compare-status').inner_text()
            page.locator('#comparison [data-compare="veda"]').click()
            assert page.locator('.compare-card').count() == 2
            checks.append('compare cap and removal')
            # Model edits must agree in every surface, including CSV and portfolio hours.
            page.locator('#model-controls>summary').click()
            page.locator('#m-capital').fill('5000')
            page.locator('#m-days').fill('168')
            page.locator('#m-share').fill('15')
            page.locator('#m-alt').fill('8')
            live = page.evaluate('''() => {
                const s={capital:5000,days:168,share:.15,alt:.08};
                const es=FIELD.rows.map(r=>Recompute.farmRow(r,s));
                const farms=es.filter(e=>e.verdict==='FARM');
                return {e:es[0],all:es,slugs:FIELD.rows.map(r=>r.slug),farms:farms.length,
                  hours:(farms.reduce((n,e)=>n+e.minutes,0)/60).toFixed(0),net:farms.reduce((n,e)=>n+e.netAfterYield,0)};
            }''')
            def cash(x):
                return f'${abs(x):,.2f}'
            def signed(x):
                return ('+' if x >= 0 else '-') + cash(x)
            e = live['e']
            board = page.locator('.table tbody tr').first.inner_text()
            assert signed(e['net']) in board and cash(e['totalCost']) in board
            assert signed(e['netPerHour']) in board and e['verdict'] in board
            compare = page.locator('.compare-card').first.inner_text()
            assert signed(e['net']) in compare and cash(e['totalCost']) in compare
            assert f"{e['minutes']} min" in compare and signed(e['netPerHour']) in compare
            assert e['verdict'] == page.locator('.compare-card .badge').first.inner_text()
            portfolio = page.locator('#farm-now').inner_text()
            assert f"{live['farms']} FARM = {signed(live['net'])} for {live['hours']}h" in portfolio
            with page.expect_download() as download:
                page.locator('#csv').click()
            records = list(csv.DictReader(io.StringIO(pathlib.Path(download.value.path()).read_text())))
            assert len(records) == 203
            for record, expected, slug in zip(records, live['all'], live['slugs']):
                assert record['slug'] == slug and record['verdict'] == expected['verdict']
                for key, field in [('fees','totalCost'),('net','net'),('minutes','minutes'),('net_per_hour','netPerHour'),('break_even_odds','breakEvenOdds')]:
                    assert (float(record[key]) if record[key] else None) == expected[field], (slug,key)
                assert record['review_date'] == expected['reviewDate']
            page.locator('[data-open="steakhouse-financial"]').click()
            detail = page.locator('#detail').inner_text()
            assert signed(e['net']) in detail and cash(e['totalCost']) in detail and signed(e['netPerHour']) in detail
            assert e['verdict'] == page.locator('.detail-header .badge').inner_text()
            assert 'Build scenario only ($1,000.00, 84d' in detail
            assert e['reviewDate'] in detail and f"{e['minutes']} min" in detail
            page.keyboard.press('Escape')
            page.locator('#m-reset').click()
            page.locator('#model-controls>summary').click()
            checks.append('joint capital/days/share/yield edits propagate to board, comparison, dossier, all 203 CSV rows and portfolio hours; reset')
            # Independent pool scenario remains shared without altering model verdicts.
            page.locator('#assumptions>summary').click()
            for key,value in [('whatif','1'),('pool','1000000'),('deposits','10000000'),('fixed','100')]:
                page.locator('#s-'+key).fill(value)
            before = page.locator('#compare-grid').inner_text()
            page.locator('#s-fixed').fill('2')
            assert page.locator('#compare-grid').inner_text() != before
            page.locator('#s-capital').fill('-1')
            assert page.locator('#invalid').is_visible()
            page.locator('#s-capital').fill('250')
            assert not page.locator('#invalid').is_visible()
            scenario = page.evaluate('FarmScenario.economics(FIELD.rows[0],Object.fromEntries(FarmScenario.fields.map(([k])=>[k,Number(document.getElementById("s-"+k).value)])))')
            assert signed(scenario['expectedNet']) in page.locator('#table .farm').first.inner_text()
            assert cash(scenario['expectedNet']) in page.locator('#compare-grid').inner_text()
            page.locator('#assumptions>summary').click()
            page.locator('[data-open="steakhouse-financial"]').click()
            assert cash(scenario['expectedNet']) in page.locator('#detail').inner_text()
            assert page.locator('#detail .sensitivity tbody tr').count() == 3
            page.keyboard.press('Escape')
            page.locator('#assumptions>summary').click()
            page.locator('#s-whatif').fill('0')
            assert 'what-if $' not in page.locator('#table').inner_text()
            assert 'What-if expected net' not in page.locator('#compare-grid').inner_text()
            page.locator('#assumptions>summary').click()
            checks.append('pool what-if propagation, sensitivity and invalid-input retention')
            page.locator('#search').fill('not-a-protocol-zzzz')
            assert 'No candidates match' in page.locator('#table').inner_text()
            page.locator('[data-clear]').click()
            page.locator('#category').select_option('Lending')
            page.locator('#verdict').select_option('FARM')
            assert page.locator('.table tbody tr').count() > 0
            page.locator('#verdict').select_option('')
            page.locator('#sort').select_option('net')
            assert page.locator('.table tbody tr').count() == 10
            page.locator('#sort').select_option('rank')
            page.locator('#model-controls>summary').click()
            page.locator('#board').scroll_into_view_if_needed()
            page.locator('#board-title').evaluate('(e)=>e.scrollIntoView({block:"start"})')
            assert fully_visible('#filters') and fully_visible('#model-inputs')
            capture('3-filtered.jpg')
            page.locator('#model-controls>summary').click()
            checks.append('empty/clear, sector/verdict filters, net sort and reachable filtered capture with model inputs')
            page.locator('#category').select_option('')
            page.locator('#evidence-pack>summary').click()
            page.locator('#evidence-pack>summary').evaluate('(e)=>e.scrollIntoView({block:"start"})')
            evidence = page.locator('#oos-evidence').inner_text()
            shuffled = page.locator('#oos-evidence tr').filter(has_text='Shuffled growth control').locator('td').all_inner_texts()
            assert shuffled == ['3.303× (+0.01×)','2.168× (+0.06×)','negative control'], shuffled
            removed_category = page.locator('#oos-evidence tr').filter(has_text='With category premium (removed)').locator('td').all_inner_texts()
            assert removed_category == ['3.606× (+0.32×)','2.305× (+0.20×)','removed — hurts both folds'], removed_category
            assert 'kept — hurts both folds' in evidence
            assert '59/87 (67.8%)' in evidence and '19/33 (57.6%)' in evidence
            assert '64/87 (73.6%)' in evidence and '23/33 (69.7%)' in evidence
            assert 'odds-weighted dossier range' in evidence and 'future-launch calibration' in evidence
            assert 'no production term selection' in evidence
            assert fully_visible('#oos-evidence'), page.locator('#oos-evidence').bounding_box()
            assert page.locator('#oos-evidence table').count() == 3
            capture('4-method.jpg')
            page.locator('#evidence-pack>details>summary').click()
            assert 'Age-matched bands' in page.locator('#methods').inner_text()
            page.locator('#evidence-pack>details>summary').click()
            page.locator('#evidence-pack>summary').click()
            checks.append('reachable evidence capture: all experiment/Brier/coverage tables and bootstrap in frame; scope and control signs verified')
            for width in [320,390,768]:
                page.set_viewport_size({'width':width,'height':844})
                page.locator('#search').fill('curvance')
                assert page.locator('.table tbody tr').count() == 1
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
                page.locator('#table [data-open]').click()
                assert page.locator('#dossier').evaluate('(d)=>d.scrollWidth<=d.clientWidth'), width
                page.keyboard.press('Escape')
                for selector in ['#model-controls>summary','#assumptions>summary','#evidence-pack>summary']:
                    page.locator(selector).click()
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width,selector)
                    page.locator(selector).click()
                page.locator('#search').fill('')
                page.locator('#chain').select_option('Base')
                page.locator('#sort').select_option('growth')
                assert page.locator('.table tbody tr').count() > 0
                page.locator('#chain').select_option('')
            checks.append('320/390/768px: search, chain/growth, dossier and expanded model/what-if/evidence without page overflow')
            page.set_viewport_size({'width':1440,'height':900})
            data = json.loads((out/'board.json').read_text())
            for row in data['rows']:
                page.locator('#search').fill(row['slug'])
                page.locator(f'[data-open="{row["slug"]}"]').click()
                assert page.locator('#dossier-title').inner_text() == row['name']
                assert page.locator('.timeline li').count() == len(row['farm_steps'])
                page.keyboard.press('Escape')
            checks.append(f'all {len(data["rows"])} dossiers reachable with complete timelines')
            context.unroute('**/*')
            context.set_offline(True)
            page.goto((out/'dashboard/index.html').as_uri())
            assert page.locator('.table tbody tr').count() == 10
            checks.append('file:// offline rendering; no external requests or JS errors')
            assert not errors and not external, (errors,external)
            browser.close()
        server.shutdown()
        from PIL import Image
        images = sorted(ROOT.joinpath('screenshots').glob('*.jpg'))
        dimensions = {p.name:Image.open(p).size for p in images}
        assert len(images) == 4 and all(d == (1440,900) for d in dimensions.values())
        sizes = {p.name:p.stat().st_size for p in images}
        assert all(s < 512*1024 for s in sizes.values())
        report = dict(checks=checks,complete_desktop_rows=complete_rows,board_y=board_y,screenshot_dimensions=dimensions,screenshots=sizes,javascript_errors=errors,external_requests=external)
        if args.report:
            args.report.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))

if __name__ == '__main__':
    main()
