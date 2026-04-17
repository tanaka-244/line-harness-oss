#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
問診票PDF生成スクリプト（美療メディセル用）
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


def draw_body_figure(c, x, y, width, height, image_path=None):
    """人体図を画像として埋め込む"""
    if image_path and os.path.exists(image_path):
        c.drawImage(image_path, x, y, width=width, height=height, 
                   preserveAspectRatio=True, anchor='c')


def generate_medicell_pdf(data, output_path, logo_path=None, body_image_path=None):
    """
    美療メディセル用問診票PDFを生成する
    
    data: {
        'name': '氏名',
        'furigana': 'ふりがな',
        'birthday': '生年月日',
        'phone': '電話番号',
        'address': '住所',
        'zipcode': '郵便番号（任意）',
        'pregnancy': 'はい/いいえ（禁忌）',
        'pacemaker': 'はい/いいえ（禁忌）',
        'skin_condition': 'はい/いいえ（皮膚疾患・禁忌）',
        'current_illness': 'ある/ない',
        'current_illness_detail': '詳細',
        'symptoms': '症状の詳細',
        'duration': '症状の期間',
        'worse_time': '症状が悪化する時',
        'severity': '症状の程度',
        'past_medicell': 'はい/いいえ（メディセル経験）',
        'treatment_area': 'ワンポイント/半身/全身/相談して決めたい',
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
    c.drawString(header_x, current_y - 8*mm, "問診票（美療メディセル）")
    
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
    
    # === 同意確認セクション（美療メディセル用） ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "【施術についての確認事項】※以下の内容をご確認の上、署名をお願いいたします。")
    current_y -= 5*mm
    
    c.setFont(FONT_NAME, 10)
    notices = [
        "□ 美療メディセルは皮膚を吸引し筋膜をほぐすことで、血液・リンパの流れを促進します",
        "□ 施術後、赤みや内出血が出る場合があります（数日で消えます）",
        "□ 効果には個人差があります",
        "□ ペースメーカー使用中・妊娠中の方は施術をお受けいただけません",
        "□ 自費施術となります"
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
    
    # === 禁忌確認 ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "●以下の項目についてお答えください（施術可否の確認）")
    current_y -= 5*mm
    
    c.setFont(FONT_NAME, 10)
    
    # 禁忌項目
    contraindications = [
        ('pregnancy', '現在妊娠中ですか'),
        ('pacemaker', 'ペースメーカーを使用していますか'),
        ('skin_condition', '施術部位に皮膚疾患（湿疹・炎症など）はありますか'),
    ]
    
    for key, label in contraindications:
        value = data.get(key, '')
        c.drawString(margin_left + 5*mm, current_y, f"・{label}: {value}")
        current_y -= 4*mm
    
    current_y -= 3*mm
    
    # === 既往歴 ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "●治療中の病気はありますか")
    current_y -= 4*mm
    
    c.setFont(FONT_NAME, 10)
    illness = data.get('current_illness', 'ない')
    if illness == 'ある':
        c.drawString(margin_left + 5*mm, current_y, f"ある: {data.get('current_illness_detail', '')}")
    else:
        c.drawString(margin_left + 5*mm, current_y, "ない")
    
    current_y -= 6*mm
    
    # === 症状セクション（人体図と並列） ===
    question_width = content_width * 0.50
    figure_width = content_width * 0.50
    section_start_y = current_y
    
    # ① 症状の詳細
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "① どのような症状がありますか（右図に該当箇所を○してください）")
    current_y -= 5*mm
    
    c.setFont(FONT_NAME, 10)
    symptoms = data.get('symptoms', '')
    if len(symptoms) > 25:
        c.drawString(margin_left + 5*mm, current_y, symptoms[:25])
        current_y -= 4*mm
        c.drawString(margin_left + 5*mm, current_y, symptoms[25:50])
    else:
        c.drawString(margin_left + 5*mm, current_y, symptoms)
    
    current_y -= 6*mm
    
    # ② 症状の期間
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "② 症状はいつからですか")
    current_y -= 5*mm
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 5*mm, current_y, data.get('duration', ''))
    
    current_y -= 6*mm
    
    # ③ 悪化する時
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "③ 症状が悪化するのはどんな時ですか")
    current_y -= 5*mm
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 5*mm, current_y, data.get('worse_time', ''))
    
    current_y -= 6*mm
    
    # ④ 症状の程度
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "④ つらさの程度（10段階）")
    current_y -= 5*mm
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 5*mm, current_y, data.get('severity', ''))
    
    # 人体図を右側に描画
    figure_x = margin_left + question_width
    figure_y = section_start_y - 70*mm
    figure_height = 68*mm
    if body_image_path is None:
        body_image_path = '/home/claude/pdf_templates/body_figure.png'
    draw_body_figure(c, figure_x, figure_y, figure_width, figure_height, body_image_path)
    
    current_y -= 8*mm
    
    # === メディセル経験 ===
    c.setFont(FONT_NAME, 11)
    past_medicell = data.get('past_medicell', 'いいえ')
    c.drawString(margin_left, current_y, "●メディセルを受けたことがありますか")
    c.drawString(margin_left + 80*mm, current_y, past_medicell)
    
    current_y -= 6*mm
    
    # === 施術部位の希望 ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "●ご希望の施術範囲")
    treatment_area = data.get('treatment_area', '')
    c.drawString(margin_left + 45*mm, current_y, treatment_area)
    
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
        'name': '佐藤 恵子',
        'furigana': 'さとう けいこ',
        'birthday': '1982年11月3日',
        'phone': '070-5555-1234',
        'address': '長野県茅野市玉川3456-7',
        'pregnancy': 'いいえ',
        'pacemaker': 'いいえ',
        'skin_condition': 'いいえ',
        'current_illness': 'ない',
        'current_illness_detail': '',
        'symptoms': '肩こりがひどく、背中も張っている',
        'duration': '1年以上',
        'worse_time': 'デスクワークが続くと悪化する',
        'severity': '6〜7（10段階）',
        'past_medicell': 'いいえ',
        'treatment_area': '半身（上半身）',
        'other_notes': '力加減は強めでお願いします',
    }
    
    output_path = '/home/claude/pdf_templates/sample_medicell.pdf'
    logo_path = '/home/claude/pdf_templates/logo.jpg'
    
    generate_medicell_pdf(sample_data, output_path, logo_path=logo_path)
    print(f"PDF generated: {output_path}")
