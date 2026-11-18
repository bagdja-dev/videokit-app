// Panduan singkat Video Lyric Editor (popup dari tombol ? di kartu beranda): infografis alur + langkah + tips.
// Infografis = SVG sebaris yang memakai token warna tema → otomatis cocok untuk mode terang/gelap.
import styles from './lyric-guide.module.css';

const P = 'var(--vk-primary)';
const SOFT = 'var(--vk-primary-soft)';
const LINE = 'var(--vk-border)';
const TEXT = 'var(--vk-text)';
const SURF = 'var(--vk-surface)';

function StepSrt() {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label="File SRT berisi lirik dan terjemahan">
      <rect x="44" y="10" width="72" height="96" rx="8" fill={SURF} stroke={LINE} strokeWidth="2" />
      <path d="M98 10v16h18" fill="none" stroke={LINE} strokeWidth="2" />
      <rect x="54" y="32" width="26" height="6" rx="3" fill={P} />
      <rect x="54" y="44" width="52" height="5" rx="2.5" fill={TEXT} opacity=".75" />
      <rect x="54" y="53" width="40" height="5" rx="2.5" fill={P} opacity=".55" />
      <rect x="54" y="66" width="26" height="6" rx="3" fill={P} />
      <rect x="54" y="78" width="48" height="5" rx="2.5" fill={TEXT} opacity=".75" />
      <rect x="54" y="87" width="36" height="5" rx="2.5" fill={P} opacity=".55" />
      <text x="80" y="118" textAnchor="middle" fontSize="11" fontWeight="700" fill={P}>.SRT</text>
    </svg>
  );
}

function StepVisual() {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label="Timeline cue dengan klip atau gambar per baris">
      <rect x="12" y="18" width="40" height="30" rx="5" fill={SOFT} stroke={P} strokeWidth="2" />
      <path d="M20 42l9-10 7 7 5-5 8 8z" fill={P} />
      <rect x="60" y="18" width="40" height="30" rx="5" fill={SOFT} stroke={P} strokeWidth="2" />
      <path d="M74 25v16l13-8z" fill={P} />
      <rect x="108" y="18" width="40" height="30" rx="5" fill={SOFT} stroke={LINE} strokeWidth="2" strokeDasharray="4 3" />
      <path d="M128 27v12M122 33h12" stroke={P} strokeWidth="2.5" strokeLinecap="round" />
      <rect x="10" y="66" width="140" height="30" rx="6" fill={SURF} stroke={LINE} strokeWidth="2" />
      <rect x="14" y="70" width="44" height="22" rx="4" fill={P} />
      <rect x="61" y="70" width="34" height="22" rx="4" fill={P} opacity=".75" />
      <rect x="98" y="70" width="48" height="22" rx="4" fill={P} opacity=".5" />
      <path d="M72 62v38" stroke="#ef4444" strokeWidth="2.5" />
      <path d="M67 60h10l-5 6z" fill="#ef4444" />
    </svg>
  );
}

function StepStyle() {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label="Gaya teks per bahasa">
      <rect x="20" y="12" width="120" height="86" rx="10" fill={SURF} stroke={LINE} strokeWidth="2" />
      <text x="80" y="52" textAnchor="middle" fontSize="22" fontWeight="800" fill={TEXT} stroke={SURF} strokeWidth="0.5">Aku cinta</text>
      <text x="80" y="72" textAnchor="middle" fontSize="13" fontStyle="italic" fill={P}>I love you</text>
      <circle cx="56" cy="88" r="5" fill={TEXT} />
      <circle cx="70" cy="88" r="5" fill={P} />
      <circle cx="84" cy="88" r="5" fill="#f59e0b" />
      <text x="104" y="92" fontSize="11" fontWeight="700" fill={TEXT}>Aa</text>
    </svg>
  );
}

function StepRender() {
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label="Render menjadi video MP4">
      <rect x="56" y="6" width="48" height="86" rx="9" fill={TEXT} />
      <rect x="60" y="12" width="40" height="74" rx="5" fill={P} opacity=".9" />
      <path d="M74 38v18l15-9z" fill={SURF} />
      <rect x="64" y="68" width="32" height="4" rx="2" fill={SURF} opacity=".9" />
      <rect x="68" y="75" width="24" height="3" rx="1.5" fill={SURF} opacity=".7" />
      <rect x="54" y="98" width="52" height="16" rx="8" fill={SOFT} stroke={P} strokeWidth="1.5" />
      <text x="80" y="110" textAnchor="middle" fontSize="10" fontWeight="800" fill={P}>MP4</text>
    </svg>
  );
}

const FLOW = [
  { title: 'Unggah lirik', body: 'File SRT: satu cue = satu potong lirik. Baris berikutnya dalam cue = terjemahan.', Art: StepSrt },
  { title: 'Isi visual per baris', body: 'Pilih cue di timeline, lalu pasang klip atau gambar di tab Visual.', Art: StepVisual },
  { title: 'Atur gaya teks', body: 'Font, warna, dan posisi untuk tiap bahasa. Gaya khusus bisa per cue.', Art: StepStyle },
  { title: 'Render MP4', body: 'Putar pratinjau, lalu render. Video jadi di perangkatmu, siap diunggah.', Art: StepRender },
];

export default function LyricEditorGuide() {
  return (
    <div className={styles.guide}>
      <p className={styles.lead}>
        Ubah file lirik atau subtitle jadi <strong>video lirik</strong> untuk TikTok, Reels, Shorts, dan YouTube. Tiap baris lirik
        punya visualnya sendiri, dan teks bisa tampil dalam beberapa bahasa sekaligus.
      </p>

      <ol className={styles.flow} aria-label="Alur singkat">
        {FLOW.map(({ title, body, Art }, i) => (
          <li key={title} className={styles.flowStep}>
            <div className={styles.art}><Art /></div>
            <span className={styles.num}>{i + 1}</span>
            <strong>{title}</strong>
            <span className={styles.muted}>{body}</span>
          </li>
        ))}
      </ol>

      <h3 className={styles.h3}>Panduan singkat</h3>
      <ol className={styles.steps}>
        <li><strong>Siapkan file SRT.</strong> Tiap cue berisi waktu dan teks. Baris ke-2, ke-3 dalam satu cue dianggap bahasa lain, misalnya Indonesia lalu English.</li>
        <li><strong>Buat project</strong> dan pilih ukuran: 9:16 (TikTok/Reels/Shorts), 16:9 (YouTube), 1:1, atau 4:5. Lalu <strong>unggah SRT</strong>.</li>
        <li>Di <strong>timeline</strong> bawah, klik cue lalu buka tab <strong>Visual</strong> untuk memasang klip atau gambar. Tab <strong>Subtitle</strong> untuk mengubah teks dan gaya khusus cue itu.</li>
        <li>Buka tab <strong>Setting</strong> untuk <strong>lagu/musik latar</strong>, video latar, serta gaya dan posisi teks default untuk semua cue.</li>
        <li>Tekan <strong>▶</strong> untuk pratinjau. Kalau lirik belum pas dengan lagu, seret tepi blok untuk mengubah durasi, atau seret badan blok untuk menggeser cue itu beserta sesudahnya.</li>
        <li>Klik <strong>Render video</strong>, lalu <strong>Unduh MP4</strong>.</li>
      </ol>

      <h3 className={styles.h3}>Tips</h3>
      <ul className={styles.tips}>
        <li><kbd>Spasi</kbd> putar/jeda · <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> urungkan.</li>
        <li>Seluruh lirik terlambat atau terlalu cepat dari lagu? Pakai <strong>Geser cue…</strong>, untuk semua cue atau mulai dari cue terpilih.</li>
        <li>Mau menambah baris lirik di antara cue yang rapat? Pakai <strong>Sisipkan &amp; geser</strong>.</li>
        <li>Render paling lancar di <strong>Chrome/Edge di laptop</strong>. Project dan media tersimpan di perangkat ini.</li>
      </ul>
    </div>
  );
}
