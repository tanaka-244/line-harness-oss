import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const compiledRoot = resolve(rootDir, 'apps/worker/.tmp-pdfgen');
const { generateChronicPdf } = await import(`${compiledRoot}/templates/chronic.js`);

const answers = {
  name: '清水 美喜子',
  furigana: 'しみず みきこ',
  birthday: '1984-07-13',
  gender: '女性',
  phone: '09052136416',
  address: '諏訪郡原村1514',
  job: 'パート・アルバイト',
  symptoms: '首の痛み、肩こりです。',
  duration: '1年以上',
  worse_time: '仕事終わりの夕方からは\nずっと毎日痛い感じです。',
  current_status: '痛みがひどく、寝る体制も\n作るのに大変です。',
  severity: '5-6',
  preferred_treatment: 'どんなものか理解していないので\nお任せしたいです。',
  other_clinic: 'いいえ',
  current_illness: 'ない',
  current_medicine: 'ない',
  referral: 'その他',
  datetime1: '4/16 11:00',
  datetime2: '4/16 15:00',
  datetime3: 'なし',
  consent: '同意する',
};

const fontPath = resolve(rootDir, 'apps/worker/fonts/NotoSansJP-Regular.ttf');
const logoPath = '/tmp/tanaka-logo.jpg';
const outputPath = resolve(rootDir, 'generated', '清水美喜子_慢性症状問診票_修正版.pdf');

const [fontBytes, logoBytes] = await Promise.all([
  readFile(fontPath),
  readFile(logoPath),
]);

const pdfBytes = await generateChronicPdf(
  answers,
  fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength),
  logoBytes.buffer.slice(logoBytes.byteOffset, logoBytes.byteOffset + logoBytes.byteLength),
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, pdfBytes);

console.log(outputPath);
