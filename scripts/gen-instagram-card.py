#!/usr/bin/env python3
"""
gen-instagram-card.py
Reads an HTML file and screenshots it at 1080x1080px using Playwright.
Usage: python3 scripts/gen-instagram-card.py --input /tmp/card.html --output /tmp/card.png
"""
import argparse
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",  required=True, help="Path to the HTML file")
    parser.add_argument("--output", required=True, help="Path to write the PNG")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        html_content = f.read()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1080, "height": 1080})
        # set_content lets external https:// images and fonts load freely
        page.set_content(html_content, wait_until="networkidle")
        page.wait_for_timeout(2000)   # extra wait for fonts & images
        page.screenshot(
            path=args.output,
            clip={"x": 0, "y": 0, "width": 1080, "height": 1080},
        )
        browser.close()


if __name__ == "__main__":
    main()
