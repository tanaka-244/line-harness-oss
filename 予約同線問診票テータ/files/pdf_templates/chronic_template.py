#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
問診票PDF生成スクリプト（慢性症状・自費用）
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


def generate_chronic_pdf(data, output_path, logo_path=None, body_image_path=None):
    """
    慢性症状用問診票PDFを生成する
    
    data: {
        'name': '氏名',
        'furigana': 'ふりがな',
        'birthday': '生年月日',
        'gender': '性別',
        'phone': '電話番号',
        'address': '住所',
        'zipcode': '郵便番号（任意）',
        'job': '職業',
        'symptoms': '症状の詳細',
        'duration': '症状の期間',
        'worse_time': '症状が悪化する時',
        'current_status': '現在の状態',
        'severity': '症状の程度',
        'preferred_treatment': '希望する施術',
        'other_clinic': 'はい/いいえ',
        'other_clinic_name': '病院名',
        'other_clinic_since': '通院期間',
        'current_illness': 'ある/ない',
        'current_illness_detail': '詳細',
        'current_medicine': 'ある/ない',
        'current_medicine_detail': '詳細',
        'referral': '来院きっかけ',
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
    c.drawString(header_x, current_y - 8*mm, "問診票（慢性症状・自費）")
    
    c.setFont(FONT_NAME, 9)
    c.drawString(header_x, current_y - 15*mm, "たなか整骨院鍼灸院")
    
    # 日付（右上）
    c.setFont(FONT_NAME, 10)
    today = datetime.now().strftime('%Y年%m月%d日').replace('年0', '年').replace('月0', '月')
    c.drawRightString(PAGE_WIDTH - margin_right, current_y - 8*mm, f"記入日: {today}")
    
    current_y -= 25*mm
    
    # === 基本情報テーブル ===
    c.setLineWidth(0.8)
    
    # 1行目：氏名、生年月日、職業、性別
    row_height = 18*mm
    name_cell_width = content_width * 0.38
    
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
    
    # 生年月日・職業セル
    middle_cell_width = 80*mm
    c.rect(margin_left + name_cell_width, current_y - row_height, middle_cell_width, row_height)
    c.setLineWidth(0.3)
    c.line(margin_left + name_cell_width, current_y - 9*mm, 
           margin_left + name_cell_width + middle_cell_width, current_y - 9*mm)
    c.setLineWidth(0.8)
    
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + name_cell_width + 2*mm, current_y - 6*mm, "生年月日")
    c.drawString(margin_left + name_cell_width + 2*mm, current_y - 15*mm, "職業")
    
    c.setFont(FONT_NAME, 11)
    birthday_wareki = convert_to_wareki(data.get('birthday', ''))
    c.drawString(margin_left + name_cell_width + 28*mm, current_y - 6*mm, birthday_wareki)
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + name_cell_width + 15*mm, current_y - 15*mm, data.get('job', ''))
    
    # 性別セル
    gender_cell_width = content_width - name_cell_width - middle_cell_width
    c.rect(margin_left + name_cell_width + middle_cell_width, current_y - row_height, 
           gender_cell_width, row_height)
    
    c.setFont(FONT_NAME, 11)
    gender = data.get('gender', '')
    gender_start_x = margin_left + name_cell_width + middle_cell_width + 2*mm
    c.drawString(gender_start_x, current_y - 10*mm, "性別")
    gender_value = '男' if gender == '男性' else ('女' if gender == '女性' else '')
    c.drawString(gender_start_x + 13*mm, current_y - 10*mm, gender_value)
    
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
    
    # === 同意確認セクション ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "【施術についての確認事項】※以下の内容をご確認の上、署名をお願いいたします。")
    current_y -= 5*mm
    
    c.setFont(FONT_NAME, 11)
    notices = [
        "□ 慢性的な症状（肩こり・腰痛など長期間続くもの）は自費施術となります",
        "□ お身体の状態に合わせて最適な施術をご提案いたします",
        "□ 領収書が必要な場合はお申し付けください"
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
    
    current_y -= 8*mm
    
    # === 症状セクション（人体図と並列） ===
    question_width = content_width * 0.50
    figure_width = content_width * 0.50
    section_start_y = current_y
    
    # ① 症状の詳細
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "① どのような症状がありますか（右図に該当箇所を○してください）")
    current_y -= 6*mm
    
    c.setFont(FONT_NAME, 11)
    symptoms = data.get('symptoms', '')
    # 長い文字列は折り返し
    if len(symptoms) > 25:
        c.drawString(margin_left + 5*mm, current_y, symptoms[:25])
        current_y -= 5*mm
        c.drawString(margin_left + 5*mm, current_y, symptoms[25:50])
    else:
        c.drawString(margin_left + 5*mm, current_y, symptoms)
    
    current_y -= 8*mm
    
    # ② 症状の期間
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "② 症状はいつからですか")
    current_y -= 6*mm
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 5*mm, current_y, data.get('duration', ''))
    
    current_y -= 8*mm
    
    # ③ 悪化する時
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "③ 症状が悪化するのはどんな時ですか")
    current_y -= 6*mm
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 5*mm, current_y, data.get('worse_time', ''))
    
    current_y -= 8*mm
    
    # ④ 症状の状態と程度
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "④ 症状の状態と程度")
    current_y -= 6*mm
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 5*mm, current_y, f"現在の状態: {data.get('current_status', '')}")
    current_y -= 5*mm
    c.drawString(margin_left + 5*mm, current_y, f"つらさの程度: {data.get('severity', '')}")
    
    current_y -= 8*mm
    
    # ⑤ 希望する施術
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "⑤ 希望する施術があればお聞かせください")
    current_y -= 6*mm
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 5*mm, current_y, data.get('preferred_treatment', ''))
    
    # 人体図を右側に描画
    figure_x = margin_left + question_width
    figure_y = section_start_y - 95*mm
    figure_height = 92*mm
    if body_image_path is None:
        body_image_path = '/home/claude/pdf_templates/body_figure.png'
    draw_body_figure(c, figure_x, figure_y, figure_width, figure_height, body_image_path)
    
    current_y -= 10*mm
    
    # === 他院受診歴 ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "上記症状で他の病院、整形外科、接骨院などにかかりましたか")
    current_y -= 6*mm
    
    c.setFont(FONT_NAME, 11)
    other_clinic = data.get('other_clinic', 'いいえ')
    if other_clinic == 'はい':
        clinic_name = data.get('other_clinic_name', '')
        clinic_since = data.get('other_clinic_since', '')
        if clinic_since:
            c.drawString(margin_left + 5*mm, current_y, f"病院名: {clinic_name}（通院期間: {clinic_since}）")
        else:
            c.drawString(margin_left + 5*mm, current_y, f"病院名: {clinic_name}")
        current_y -= 5*mm
    
    current_y -= 5*mm
    
    # === 既往歴・その他 ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "他に今までにあった病気やアレルギー、ペースメーカー、妊娠中、気になることなどあればご記入ください")
    current_y -= 3*mm
    
    other_box_height = 18*mm
    c.rect(margin_left, current_y - other_box_height, content_width, other_box_height)
    
    c.setFont(FONT_NAME, 11)
    info_y = current_y - 6*mm
    illness = data.get('current_illness', 'ない')
    medicine = data.get('current_medicine', 'ない')
    
    info_lines = []
    if illness == 'ある':
        info_lines.append(f"治療中の病気: {data.get('current_illness_detail', '')}")
    if medicine == 'ある':
        info_lines.append(f"服用中の薬: {data.get('current_medicine_detail', '')}")
    
    for line in info_lines:
        c.drawString(margin_left + 3*mm, info_y, line)
        info_y -= 6*mm
    
    current_y -= other_box_height + 5*mm
    
    # === 来院きっかけ ===
    referral = data.get('referral', '')
    if referral:
        c.setFont(FONT_NAME, 11)
        c.drawString(margin_left, current_y, "●ご来院のきっかけ")
        c.setFont(FONT_NAME, 11)
        c.drawString(margin_left + 38*mm, current_y, referral)
        current_y -= 8*mm
    
    # === 施術者記入欄 ===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "【施術者記入欄】")
    current_y -= 3*mm
    
    bottom_margin = 12*mm
    memo_height = current_y - bottom_margin
    c.rect(margin_left, bottom_margin, content_width, memo_height)
    
    c.save()
    return output_path


if __name__ == "__main__":
    sample_data = {
        'name': '山田 花子',
        'furigana': 'やまだ はなこ',
        'birthday': '1975年8月15日',
        'gender': '女性',
        'phone': '090-9876-5432',
        'address': '長野県茅野市宮川1234-5',
        'job': '主婦',
        'symptoms': '肩こりがひどく、頭痛もある',
        'duration': '3ヶ月以上',
        'worse_time': 'デスクワークの後、夕方になると悪化する',
        'current_status': '良くなったり悪くなったりを繰り返している',
        'severity': '5〜6（10段階）',
        'preferred_treatment': '鍼灸を試してみたい',
        'other_clinic': 'はい',
        'other_clinic_name': '茅野中央病院',
        'other_clinic_since': '半年前から',
        'current_illness': 'ない',
        'current_medicine': 'ある',
        'current_medicine_detail': '頭痛薬（ロキソニン）を時々服用',
        'referral': '友人の紹介',
    }
    
    output_path = '/home/claude/pdf_templates/sample_chronic.pdf'
    logo_path = '/home/claude/pdf_templates/logo.jpg'
    
    generate_chronic_pdf(sample_data, output_path, logo_path=logo_path)
    print(f"PDF generated: {output_path}")
