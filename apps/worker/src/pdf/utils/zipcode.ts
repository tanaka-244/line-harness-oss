/**
 * 住所から郵便番号を取得する（長野県・原村周辺対応）
 * 住所文字列に郵便番号が含まれている場合はそちらを優先
 */
export function getZipcodeFromAddress(address: string): string {
  if (!address) return '';

  // 住所に郵便番号が含まれている場合
  const embedded = address.match(/(\d{3})-(\d{4})/);
  if (embedded) return `${embedded[1]}-${embedded[2]}`;

  const zipcodeMap: [string, string][] = [
    ['原村', '391-0100'],
    ['茅野市', '391-0000'],
    ['諏訪市', '392-0000'],
    ['富士見町', '399-0200'],
    ['下諏訪町', '393-0000'],
  ];

  for (const [area, zipcode] of zipcodeMap) {
    if (address.includes(area)) return zipcode;
  }

  return '';
}
