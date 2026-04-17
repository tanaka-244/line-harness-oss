#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
問診票PDF生成スクリプト（美容鍼用）
たなか整骨院鍼灸院
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from datetime import datetime
import os
import re


def get_zipcode_from_address(address):
    """住所から郵便番号を取得する"""
    if not address:
        return ''
    
    zipcode_map = {
        '原村': '391-0100',
        '茅野市': '391-0000',
        '諏訪市': '392-0000',
        '富士見町': '399-0200',
        '下諏訪町': '393-0000',
    }
    
    for area, zipcode in zipcode_map.items():
        if area in address:
            return zipcode
    
    match = re.search(r'(\d{3})-?(\d{4})', address)
    if match:
        return f'{match.group(1)}-{match.group(2)}'
    
    return ''


def convert_to_wareki(date_str):
    """生年月日を和暦に変換する"""
    if not date_str:
        return ''
    
    wareki_patterns = ['明治', '大正', '昭和', '平成', '令和', 'M', 'T', 'S', 'H', 'R']
    for pattern in wareki_patterns:
        if pattern in date_str:
            return date_str
    
    match = re.match(r'(\d{4})年(\d{1,2})月(\d{1,2})日', date_str)
    if not match:
        match = re.match(r'(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})', date_str)
    
    if not match:
        return date_str
    
    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    
    if year >= 2019:
        if year == 2019 and month < 5:
            wareki_year = 31
            era = '平成'
        else:
            wareki_year = year - 2018
            era = '令和'
    elif year >= 1989:
        if year == 1989 and month == 1 and day < 8:
            wareki_year = 64
            era = '昭和'
        else:
            wareki_year = year - 1988
            era = '平成'
    elif year >= 1926:
        if year == 1926 and month < 12:
            wareki_year = 15
            era = '大正'
        elif year == 1926 and month == 12 and day < 25:
            wareki_year = 15
            era = '大正'
        else:
            wareki_year = year - 1925
            era = '昭和'
    elif year >= 1912:
        if year == 1912 and month < 7:
            wareki_year = 45
            era = '明治'
        elif year == 1912 and month == 7 and day < 30:
            wareki_year = 45
            era = '明治'
        else:
            wareki_year = year - 1911
            era = '大正'
    else:
        wareki_year = year - 1867
        era = '明治'
    
    if wareki_year == 1:
        return f'{era}元年{month}月{day}日'
    else:
        return f'{era}{wareki_year}年{month}月{day}日'


# 日本語フォント登録
pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
FONT_NAME = 'HeiseiKakuGo-W5'

PAGE_WIDTH, PAGE_HEIGHT = A4


def generate_beauty_pdf(data, output_path, logo_path=None):
    """
    美容鍼用問診票PDFを生成する
    
    data: {
        'name': '氏名',
        'furigana': 'ふりがな',
        'birthday': '生年月日',
        'phone': '電話番号',
        'address': '住所',
        'zipcode': '郵便番号（任意）',
        'menu': '美容鍼 / 美容鍼＋メディセル',
        'past_beauty': 'はい/いいえ（美容鍼経験）',
        'past_bleeding': 'はい/いいえ（内出血経験）',
        'alcohol_skin': 'はい/いいえ（アルコール反応）',
        'facial_palsy': 'はい/いいえ（顔面麻痺）',
        'blood_thinner': 'はい/いいえ（血液サラサラ薬）',
        'pregnancy': 'はい/いいえ（妊娠中）',
        'pacemaker': 'はい/いいえ（ペースメーカー）',
        'face_concerns': 'お顔の悩み（テキスト）',
        'top3_concerns': '特に気になる3つ',
        'event': 'はい/いいえ（イベント予定）',
        'event_detail': 'イベント詳細',
        'other_notes': 'その他',
    }
    """
    c = canvas.Canvas(output_path, pagesize=A4)
    
    margin_left = 15*mm
    margin_right = 15*mm
    margin_top = 12*mm
    content_width = PAGE_WIDTH - margin_left - margin_right
    
    current_y = PAGE_HEIGHT - margin_top
    
    # === ヘッダー ===
    if logo_path and os.path.exists(logo_path):
        logo_width = 18*mm
        logo_height = 18*mm
        c.drawImage(logo_path, margin_left, current_y - logo_height, 
                   width=logo_width, height=logo_height, preserveAspectRatio=True)
        header_x = margin_left + logo_width + 3*mm
    else:
        header_x = margin_left
    
    c.setFont(FONT_NAME, 16)
    c.drawString(header_x, current_y - 8*mm, "問診票（美容鍼）")
    
    c.setFont(FONT_NAME, 9)
    c.drawString(header_x, current_y - 15*mm, "たなか整骨院鍼灸院")
    
    # 日付（右上）
    c.setFont(FONT_NAME, 10)
    today = datetime.now().strftime('%Y年%m月%d日').replace('年0', '年').replace('月0', '月')
    c.drawRightString(PAGE_WIDTH - margin_right, current_y - 8*mm, f"記入日: {today}")
    
    current_y -= 25*mm
    
    # === 基本情報テーブル（性別なし）===
    c.setLineWidth(0.8)
    
    # 1行目：氏名、生年月日
    row_height = 18*mm
    name_cell_width = content_width * 0.50
    birthday_cell_width = content_width * 0.50
    
    c.rect(margin_left, current_y - row_height, name_cell_width, row_height)
    
    # 氏名セル内の分割線
    c.setLineWidth(0.3)
    c.line(margin_left, current_y - 7*mm, margin_left + name_cell_width, current_y - 7*mm)
    c.line(margin_left + 22*mm, current_y, margin_left + 22*mm, current_y - row_height)
    c.setLineWidth(0.8)
    
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 2*mm, current_y - 5*mm, "ふりがな")
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 2*mm, current_y - 14*mm, "氏名")
    
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 25*mm, current_y - 5*mm, data.get('furigana', ''))
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 25*mm, current_y - 14*mm, data.get('name', ''))
    
    # 生年月日セル
    c.rect(margin_left + name_cell_width, current_y - row_height, birthday_cell_width, row_height)
    
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + name_cell_width + 2*mm, current_y - 10*mm, "生年月日")
    birthday_wareki = convert_to_wareki(data.get('birthday', ''))
    c.drawString(margin_left + name_cell_width + 28*mm, current_y - 10*mm, birthday_wareki)
    
    current_y -= row_height
    
    # 2行目：住所、電話番号
    row_height = 15*mm
    address_width = content_width * 0.7
    phone_width = content_width * 0.3
    
    c.rect(margin_left, current_y - row_height, address_width, row_height)
    c.rect(margin_left + address_width, current_y - row_height, phone_width, row_height)
    
    c.setLineWidth(0.3)
    c.line(margin_left + 22*mm, current_y, margin_left + 22*mm, current_y - row_height)
    c.setLineWidth(0.8)
    
    address = data.get('address', '')
    zipcode = data.get('zipcode', '') or get_zipcode_from_address(address)
    
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 2*mm, current_y - 9*mm, "住所")
    
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 25*mm, current_y - 5*mm, f"〒{zipcode}")
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 25*mm, current_y - 12*mm, address)
    
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + address_width + 2*mm, current_y - 6*mm, "電話番号")
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + address_width + 2*mm, current_y - 12*mm, data.get('phone', ''))
    
    current_y -= row_height + 5*mm
    
    # === 同意確認セクション（美容鍼用） ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "【施術についての確認事項】※以下の内容をご確認の上、署名をお願いいたします。")
    current_y -= 5*mm
    
    c.setFont(FONT_NAME, 10)
    notices = [
        "□ 美容鍼は自費施術となります",
        "□ 使い捨ての鍼を使用しており、感染の心配はありません",
        "□ 効果には個人差があります",
        "□ 内出血の可能性があります（数日〜数週間で消えます）",
        "□ イベント前の施術は事前にお申し出ください",
        "□ 医療行為ではなく、効果を保証するものではありません"
    ]
    
    for notice in notices:
        c.drawString(margin_left, current_y, notice)
        current_y -= 4.5*mm
    
    current_y -= 2*mm
    
    # 署名欄
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "上記内容を確認し、同意いたします。")
    current_y -= 8*mm
    
    sign_label_x = margin_left + content_width * 0.5
    c.drawString(sign_label_x, current_y, "署名")
    c.line(sign_label_x + 12*mm, current_y - 1*mm, sign_label_x + 80*mm, current_y - 1*mm)
    
    current_y -= 10*mm
    
    # === 施術メニュー ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "●ご希望のメニュー")
    menu = data.get('menu', '')
    c.drawString(margin_left + 40*mm, current_y, menu)
    
    current_y -= 8*mm
    
    # === 禁忌確認 ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "●以下の項目についてお答えください")
    current_y -= 5*mm
    
    check_items = [
        ('past_beauty', '美容鍼を受けたことがありますか'),
        ('past_bleeding', '（経験ありの場合）内出血したことがありますか'),
        ('alcohol_skin', 'アルコール消毒で肌が赤くなりますか'),
        ('facial_palsy', '顔面麻痺の既往がありますか'),
        ('blood_thinner', '血液をサラサラにする薬を服用していますか'),
        ('pregnancy', '現在妊娠中ですか'),
        ('pacemaker', 'ペースメーカーを使用していますか'),
    ]
    
    c.setFont(FONT_NAME, 10)
    for key, label in check_items:
        value = data.get(key, '')
        c.drawString(margin_left + 5*mm, current_y, f"・{label}: {value}")
        current_y -= 4.5*mm
    
    current_y -= 3*mm
    
    # === お顔の悩み ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "●お顔で気になることをお聞かせください")
    current_y -= 4*mm
    
    concerns_box_height = 18*mm
    c.rect(margin_left, current_y - concerns_box_height, content_width, concerns_box_height)
    
    c.setFont(FONT_NAME, 10)
    face_concerns = data.get('face_concerns', '')
    # 長文対応
    if len(face_concerns) > 50:
        c.drawString(margin_left + 3*mm, current_y - 6*mm, face_concerns[:50])
        c.drawString(margin_left + 3*mm, current_y - 12*mm, face_concerns[50:100])
    else:
        c.drawString(margin_left + 3*mm, current_y - 9*mm, face_concerns)
    
    current_y -= concerns_box_height + 6*mm
    
    # 特に気になる3つ
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "●特に気になる点（3つまで）")
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 55*mm, current_y, data.get('top3_concerns', ''))
    
    current_y -= 6*mm
    
    # === イベント予定 ===
    c.setFont(FONT_NAME, 11)
    event = data.get('event', 'いいえ')
    c.drawString(margin_left, current_y, "●近日中にイベント（結婚式・撮影など）の予定がありますか")
    c.drawString(margin_left + 5*mm + 130*mm, current_y, event)
    
    if event == 'はい':
        current_y -= 4*mm
        c.setFont(FONT_NAME, 10)
        c.drawString(margin_left + 5*mm, current_y, f"詳細: {data.get('event_detail', '')}")
    
    current_y -= 6*mm
    
    # === その他 ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "●その他、ご質問やご要望があればお聞かせください")
    current_y -= 4*mm
    
    # その他欄と施術者記入欄を同じ高さにするため、残りスペースを半分ずつ
    bottom_margin = 12*mm
    remaining_space = current_y - bottom_margin - 6*mm  # 6mm = 施術者ラベル分
    other_box_height = remaining_space / 2
    
    c.rect(margin_left, current_y - other_box_height, content_width, other_box_height)
    
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 3*mm, current_y - 8*mm, data.get('other_notes', ''))
    
    current_y -= other_box_height + 4*mm
    
    # === 施術者記入欄 ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "【施術者記入欄】")
    current_y -= 3*mm
    
    memo_height = current_y - bottom_margin
    c.rect(margin_left, bottom_margin, content_width, memo_height)
    
    c.save()
    return output_path


if __name__ == "__main__":
    sample_data = {
        'name': '鈴木 美咲',
        'furigana': 'すずき みさき',
        'birthday': '1990年5月20日',
        'phone': '080-1234-5678',
        'address': '長野県諏訪郡原村払沢5678-9',
        'menu': '美容鍼',
        'past_beauty': 'いいえ',
        'past_bleeding': '',
        'alcohol_skin': 'いいえ',
        'facial_palsy': 'いいえ',
        'blood_thinner': 'いいえ',
        'pregnancy': 'いいえ',
        'pacemaker': 'いいえ',
        'face_concerns': 'ほうれい線が気になる、目の下のたるみ、肌のハリがなくなってきた',
        'top3_concerns': 'ほうれい線、たるみ、ハリ',
        'event': 'はい',
        'event_detail': '来月友人の結婚式がある',
        'other_notes': '痛みに弱いので、なるべく優しくお願いします',
    }
    
    output_path = '/home/claude/pdf_templates/sample_beauty.pdf'
    logo_path = '/home/claude/pdf_templates/logo.jpg'
    
    generate_beauty_pdf(sample_data, output_path, logo_path=logo_path)
    print(f"PDF generated: {output_path}")
