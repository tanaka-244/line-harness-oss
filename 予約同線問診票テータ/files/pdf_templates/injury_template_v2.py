#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
問診票PDF生成スクリプト（ケガ・急性症状用）
たなか整骨院鍼灸院
元の問診票に近いレイアウト
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
import requests


def get_zipcode_from_address(address):
    """
    住所から郵便番号を取得する（Yahoo! or 国土地理院APIなど）
    ここでは簡易的に住所パターンマッチで対応
    実際の運用では郵便番号DBやAPIを使用
    """
    if not address:
        return ''
    
    # 長野県の主要な郵便番号マッピング（原村周辺）
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
    
    # 郵便番号が住所に含まれている場合は抽出
    match = re.search(r'(\d{3})-?(\d{4})', address)
    if match:
        return f'{match.group(1)}-{match.group(2)}'
    
    return ''


def convert_relative_date(date_str, base_date=None):
    """
    相対日付（昨日、今日、一昨日など）を年月日に変換する
    """
    if not date_str:
        return ''
    
    if base_date is None:
        base_date = datetime.now()
    
    # すでに年月日形式の場合はそのまま返す
    if re.search(r'\d{4}年\d{1,2}月\d{1,2}日', date_str):
        return date_str
    if re.search(r'\d{1,2}月\d{1,2}日', date_str):
        return date_str
    
    from datetime import timedelta
    
    # 相対日付のマッピング
    relative_map = {
        '今日': 0,
        '本日': 0,
        '昨日': -1,
        '一昨日': -2,
        'おととい': -2,
        '3日前': -3,
        '三日前': -3,
        '4日前': -4,
        '四日前': -4,
        '5日前': -5,
        '五日前': -5,
        '1週間前': -7,
        '一週間前': -7,
        '2週間前': -14,
        '二週間前': -14,
        '1ヶ月前': -30,
        '一ヶ月前': -30,
    }
    
    for pattern, days in relative_map.items():
        if pattern in date_str:
            target_date = base_date + timedelta(days=days)
            return target_date.strftime('%Y年%m月%d日').replace('年0', '年').replace('月0', '月')
    
    # 「〜日前」パターン
    match = re.search(r'(\d+)日前', date_str)
    if match:
        days = int(match.group(1))
        target_date = base_date + timedelta(days=-days)
        return target_date.strftime('%Y年%m月%d日').replace('年0', '年').replace('月0', '月')
    
    # 変換できない場合はそのまま返す
    return date_str


def convert_to_wareki(date_str):
    """
    生年月日を和暦に変換する
    対応形式: 
    - 1990年1月15日, 1990/1/15, 1990-01-15
    - 平成2年1月15日（そのまま返す）
    """
    if not date_str:
        return ''
    
    # すでに和暦の場合はそのまま返す
    wareki_patterns = ['明治', '大正', '昭和', '平成', '令和', 'M', 'T', 'S', 'H', 'R']
    for pattern in wareki_patterns:
        if pattern in date_str:
            return date_str
    
    # 西暦から年月日を抽出
    # パターン1: 1990年1月15日
    match = re.match(r'(\d{4})年(\d{1,2})月(\d{1,2})日', date_str)
    if not match:
        # パターン2: 1990/1/15 or 1990-01-15
        match = re.match(r'(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})', date_str)
    
    if not match:
        # 変換できない場合はそのまま返す
        return date_str
    
    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    
    # 和暦に変換
    if year >= 2019:
        # 令和（2019年5月1日〜）
        if year == 2019 and month < 5:
            wareki_year = 31  # 平成31年
            era = '平成'
        else:
            wareki_year = year - 2018
            era = '令和'
    elif year >= 1989:
        # 平成（1989年1月8日〜2019年4月30日）
        if year == 1989 and month == 1 and day < 8:
            wareki_year = 64  # 昭和64年
            era = '昭和'
        else:
            wareki_year = year - 1988
            era = '平成'
    elif year >= 1926:
        # 昭和（1926年12月25日〜1989年1月7日）
        if year == 1926 and month < 12:
            wareki_year = 15  # 大正15年
            era = '大正'
        elif year == 1926 and month == 12 and day < 25:
            wareki_year = 15
            era = '大正'
        else:
            wareki_year = year - 1925
            era = '昭和'
    elif year >= 1912:
        # 大正（1912年7月30日〜1926年12月24日）
        if year == 1912 and month < 7:
            wareki_year = 45  # 明治45年
            era = '明治'
        elif year == 1912 and month == 7 and day < 30:
            wareki_year = 45
            era = '明治'
        else:
            wareki_year = year - 1911
            era = '大正'
    else:
        # 明治（〜1912年7月29日）
        wareki_year = year - 1867
        era = '明治'
    
    # 元年の場合
    if wareki_year == 1:
        return f'{era}元年{month}月{day}日'
    else:
        return f'{era}{wareki_year}年{month}月{day}日'

# 日本語フォント登録
pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
FONT_NAME = 'HeiseiKakuGo-W5'

# ページサイズ
PAGE_WIDTH, PAGE_HEIGHT = A4

def draw_body_figure(c, x, y, width, height, image_path=None):
    """人体図を画像として埋め込む"""
    if image_path and os.path.exists(image_path):
        # 画像を埋め込み（アスペクト比を維持）
        c.drawImage(image_path, x, y, width=width, height=height, 
                   preserveAspectRatio=True, anchor='c')


def generate_injury_pdf(data, output_path, logo_path=None):
    """
    ケガ・急性症状用の問診票PDFを生成（元の問診票に近いレイアウト）
    """
    c = canvas.Canvas(output_path, pagesize=A4)
    
    # マージン設定
    margin_left = 12*mm
    margin_right = 12*mm
    margin_top = 12*mm
    content_width = PAGE_WIDTH - margin_left - margin_right
    current_y = PAGE_HEIGHT - margin_top
    
    # === ヘッダー：タイトルと来院日 ===
    c.setFont(FONT_NAME, 24)
    c.drawCentredString(PAGE_WIDTH / 2 - 30*mm, current_y - 8*mm, "問診票")
    
    c.setFont(FONT_NAME, 11)
    c.drawString(PAGE_WIDTH / 2 + 20*mm, current_y - 5*mm, "来院日")
    c.drawString(PAGE_WIDTH / 2 + 45*mm, current_y - 5*mm, "年")
    c.drawString(PAGE_WIDTH / 2 + 60*mm, current_y - 5*mm, "月")
    c.drawString(PAGE_WIDTH / 2 + 75*mm, current_y - 5*mm, "日")
    
    current_y -= 18*mm
    
    # === 基本情報テーブル ===
    c.setLineWidth(0.8)
    
    # 1行目：氏名・ふりがな、生年月日、性別
    row_height = 18*mm
    
    # 氏名セル
    name_cell_width = 75*mm
    c.rect(margin_left, current_y - row_height, name_cell_width, row_height)
    
    # 氏名セル内の分割線（ふりがな）- 縦線を少し右に
    c.setLineWidth(0.3)
    c.line(margin_left, current_y - 7*mm, margin_left + name_cell_width, current_y - 7*mm)
    c.line(margin_left + 22*mm, current_y, margin_left + 22*mm, current_y - row_height)
    c.setLineWidth(0.8)
    
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 2*mm, current_y - 5*mm, "ふりがな")
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 2*mm, current_y - 14*mm, "氏名")
    
    # データ記入
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
    # 生年月日を和暦に変換して表示
    birthday_wareki = convert_to_wareki(data.get('birthday', ''))
    c.drawString(margin_left + name_cell_width + 28*mm, current_y - 6*mm, birthday_wareki)
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + name_cell_width + 15*mm, current_y - 15*mm, data.get('job', ''))
    
    # 性別セル（コンパクトに）
    gender_cell_width = content_width - name_cell_width - middle_cell_width
    c.rect(margin_left + name_cell_width + middle_cell_width, current_y - row_height, 
           gender_cell_width, row_height)
    
    c.setFont(FONT_NAME, 11)
    gender = data.get('gender', '')
    # 性別ラベルと値を横並びに（中央揃え）
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
    
    # 住所の縦線（氏名欄と揃える）
    c.setLineWidth(0.3)
    c.line(margin_left + 22*mm, current_y, margin_left + 22*mm, current_y - row_height)
    c.setLineWidth(0.8)
    
    # 郵便番号を住所から取得
    address = data.get('address', '')
    zipcode = data.get('zipcode', '') or get_zipcode_from_address(address)
    
    # 住所ラベル
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 2*mm, current_y - 9*mm, "住所")
    
    # 郵便番号（枠内上部）
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 25*mm, current_y - 5*mm, f"〒{zipcode}")
    
    # 住所（郵便番号の下）
    c.setFont(FONT_NAME, 10)
    c.drawString(margin_left + 25*mm, current_y - 12*mm, address)
    
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + address_width + 2*mm, current_y - 6*mm, "電話番号")
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + address_width + 2*mm, current_y - 12*mm, data.get('phone', ''))
    
    current_y -= row_height + 5*mm
    
    # === 同意確認セクション（LINE問診と同じ内容）===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "【施術についての確認事項】※以下の内容をご確認の上、署名をお願いいたします。")
    current_y -= 5*mm
    
    c.setFont(FONT_NAME, 11)
    notices = [
        "□ 整骨院での保険適用は、ケガをした日から約1ヶ月以内の急性症状",
        "　（捻挫・打撲・挫傷・骨折/脱臼の応急処置）が対象です",
        "□ 慢性的な症状（肩こり・腰痛など長期間続くもの）は自費施術となります",
        "□ 通勤中・業務中のケガは「労災保険」、交通事故は「自賠責保険」の扱いとなります",
        "□ 当院では保険施術と自費施術の併用により、早期改善を推奨しております",
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
    
    # 署名線
    sign_label_x = margin_left + content_width * 0.5
    c.drawString(sign_label_x, current_y, "署名")
    c.line(sign_label_x + 12*mm, current_y - 1*mm, sign_label_x + 80*mm, current_y - 1*mm)
    
    current_y -= 8*mm
    
    # === 症状セクション（人体図と並列） ===
    # 左側：質問、右側：人体図
    question_width = content_width * 0.50
    figure_width = content_width * 0.50
    section_start_y = current_y
    
    # ① 本日の症状（痛みの場所のみ・枠なし）
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "① 本日の症状をご記入ください（右図に該当箇所を○してください）")
    current_y -= 6*mm
    
    # 症状記入（枠なし）
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 5*mm, current_y, data.get('pain_location', ''))
    
    current_y -= 8*mm
    
    # ② 症状はいつから（相対日付を年月日に変換）
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "② 症状はいつ（日時）からですか")
    current_y -= 6*mm
    
    # 相対日付を年月日に変換
    injury_when_raw = data.get('injury_when', '')
    injury_when_date = convert_relative_date(injury_when_raw)
    
    # 年月日形式で表示
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 5*mm, current_y, injury_when_date)
    
    current_y -= 8*mm
    
    # ③ どこで、何をして
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "③ どこで、何をして症状が出ましたか")
    current_y -= 6*mm
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left + 5*mm, current_y, f"場所: {data.get('injury_where', '')}")
    current_y -= 5*mm
    c.drawString(margin_left + 5*mm, current_y, f"何をして: {data.get('injury_how', '')}")
    
    current_y -= 8*mm
    
    # ④ 症状について（痛みの程度とその他の症状）
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "④ 症状について")
    current_y -= 6*mm
    c.setFont(FONT_NAME, 11)
    pain_level = data.get('pain_level', '')
    current_state = data.get('current_state', '')
    c.drawString(margin_left + 5*mm, current_y, f"痛みの程度: {pain_level}")
    if current_state:
        current_y -= 5*mm
        c.drawString(margin_left + 5*mm, current_y, f"その他: {current_state}")
    
    # 人体図を右側に描画（画像を使用）
    figure_x = margin_left + question_width
    figure_y = section_start_y - 95*mm
    figure_height = 92*mm
    body_image_path = '/home/claude/pdf_templates/body_figure.png'
    draw_body_figure(c, figure_x, figure_y, figure_width, figure_height, body_image_path)
    
    current_y -= 8*mm
    
    # === 他院受診歴（複数対応）===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "上記症状で他の病院、整形外科、接骨院などにかかりましたか")
    current_y -= 6*mm
    
    c.setFont(FONT_NAME, 11)
    other_clinic = data.get('other_clinic', 'いいえ')
    if other_clinic == 'はい':
        # 複数の病院情報に対応（リスト形式）
        clinic_list = data.get('other_clinic_list', [])
        if clinic_list:
            # リスト形式で渡された場合
            for clinic_info in clinic_list:
                clinic_name = clinic_info.get('name', '')
                diagnosis = clinic_info.get('diagnosis', '')
                if diagnosis:
                    c.drawString(margin_left + 5*mm, current_y, f"病院名: {clinic_name}（診断名: {diagnosis}）")
                else:
                    c.drawString(margin_left + 5*mm, current_y, f"病院名: {clinic_name}")
                current_y -= 5*mm
        else:
            # 従来形式（単一）
            clinic_name = data.get('other_clinic_name', '')
            diagnosis = data.get('other_clinic_diagnosis', '')
            if diagnosis:
                c.drawString(margin_left + 5*mm, current_y, f"病院名: {clinic_name}（診断名: {diagnosis}）")
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
    
    # データ記入
    c.setFont(FONT_NAME, 11)
    info_y = current_y - 6*mm
    illness = data.get('current_illness', 'ない')
    medicine = data.get('current_medicine', 'ない')
    past_injury = data.get('past_injury', '')
    
    info_lines = []
    if illness == 'ある':
        info_lines.append(f"治療中の病気: {data.get('current_illness_detail', '')}")
    if medicine == 'ある':
        info_lines.append(f"服用中の薬: {data.get('current_medicine_detail', '')}")
    if past_injury == 'ある':
        info_lines.append("過去に同じ場所をケガしたことがある")
    
    for line in info_lines:
        c.drawString(margin_left + 3*mm, info_y, line)
        info_y -= 6*mm
    
    current_y -= other_box_height + 5*mm
    
    # === 来院きっかけ（入力があった場合のみ表示）===
    referral = data.get('referral', '')
    if referral:
        c.setFont(FONT_NAME, 11)
        c.drawString(margin_left, current_y, "●ご来院のきっかけ")
        c.setFont(FONT_NAME, 11)
        c.drawString(margin_left + 38*mm, current_y, referral)
        current_y -= 8*mm
    
    # === 施術者記入欄（残りのスペースを使う）===
    c.setFont(FONT_NAME, 11)
    c.drawString(margin_left, current_y, "【施術者記入欄】")
    current_y -= 3*mm
    
    # 下マージンを12mmとして、残りを施術者記入欄に
    bottom_margin = 12*mm
    memo_height = current_y - bottom_margin
    c.rect(margin_left, bottom_margin, content_width, memo_height)
    
    # PDF保存
    c.save()
    return output_path


# サンプルデータでテスト
if __name__ == "__main__":
    sample_data = {
        'name': '田中 太郎',
        'furigana': 'たなか たろう',
        'birthday': '1985年3月20日',  # 西暦で入力 → 昭和60年3月20日に変換される
        'gender': '男性',
        'phone': '090-1234-5678',
        'address': '長野県諏訪郡原村室内12345-1',  # 原村から郵便番号を自動取得
        'job': '会社員',
        'pain_location': '右足首の外側',
        'injury_when': '昨日',
        'injury_where': 'スポーツ中',
        'injury_how': 'サッカー中に相手と接触して転倒した',
        'current_state': '腫れている、熱感がある',  # ④のその他に表示
        'pain_level': '5〜6（10段階）',
        'past_injury': 'ない',
        'other_clinic': 'はい',  # 複数病院テスト用に変更
        'other_clinic_list': [
            {'name': '諏訪中央病院', 'diagnosis': '足関節捻挫'},
            {'name': '茅野整形外科', 'diagnosis': '靭帯損傷'}
        ],
        'current_illness': 'ない',
        'current_medicine': 'ない',
        'referral': 'Googleマップ',
        'consent_date': '2026年4月12日'
    }
    
    # 和暦変換のテスト
    print("=== 和暦変換テスト ===")
    test_dates = [
        '1985年3月20日',   # → 昭和60年3月20日
        '1990/1/15',       # → 平成2年1月15日
        '2000-05-01',      # → 平成12年5月1日
        '2019年5月1日',    # → 令和元年5月1日
        '2020年1月1日',    # → 令和2年1月1日
        '平成2年1月15日',  # → そのまま
    ]
    for date in test_dates:
        print(f"  {date} → {convert_to_wareki(date)}")
    
    # 郵便番号取得テスト
    print("\n=== 郵便番号取得テスト ===")
    print(f"  {sample_data['address']} → 〒{get_zipcode_from_address(sample_data['address'])}")
    
    # 相対日付変換テスト
    print("\n=== 相対日付変換テスト ===")
    test_relative_dates = ['昨日', '今日', '一昨日', '3日前', '1週間前']
    for d in test_relative_dates:
        print(f"  {d} → {convert_relative_date(d)}")
    
    output_path = '/home/claude/pdf_templates/sample_injury_v2.pdf'
    
    generate_injury_pdf(sample_data, output_path)
    print(f"\nPDF generated: {output_path}")
