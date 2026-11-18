// Diagnostik dasar browser yang tetap berguna walau bundle React gagal dimuat (mis. browser tablet lama).
// Tidak menyentuh DOM sebelum hydration (agar tidak bentrok dengan React): hanya mengisi window.__vkDiag.
// Bila React tidak jalan dalam 8 detik, barulah kotak diagnostik ditulis langsung ke halaman.
export const BOOT_DIAG = `(function(){
  var lines=window.__vkDiag=[];
  function add(t,bad){lines.push({t:t,bad:!!bad});if(window.__vkDiagRender)window.__vkDiagRender();}
  add('Browser: '+navigator.userAgent);
  add('Koneksi aman (HTTPS): '+(window.isSecureContext?'ya':'TIDAK'),!window.isSecureContext);
  add('WebCodecs VideoEncoder: '+(typeof VideoEncoder!=='undefined'?'ada':'TIDAK ADA'),typeof VideoEncoder==='undefined');
  add('OffscreenCanvas: '+(typeof OffscreenCanvas!=='undefined'?'ada':'TIDAK ADA'),typeof OffscreenCanvas==='undefined');
  add('OPFS: '+(navigator.storage&&navigator.storage.getDirectory?'ada':'TIDAK ADA'),!(navigator.storage&&navigator.storage.getDirectory));
  add('Web Worker & WebAssembly: '+(typeof Worker!=='undefined'&&typeof WebAssembly!=='undefined'?'ada':'TIDAK ADA'));
  window.addEventListener('error',function(e){add('Error JS: '+(e.message||e),true);});
  window.addEventListener('unhandledrejection',function(e){add('Promise ditolak: '+(e.reason&&(e.reason.message||e.reason)),true);});
  setTimeout(function(){
    if(window.__vkHydrated)return;
    add('Aplikasi (React) belum berjalan setelah 8 detik — kemungkinan JavaScript tidak didukung browser ini',true);
    var box=document.createElement('div');
    box.style.cssText='font:13px/1.5 monospace;padding:12px 16px;word-break:break-all;background:#fff;color:#14212b';
    window.__vkDiagRender=function(){box.innerHTML='';lines.forEach(function(l){var p=document.createElement('div');p.textContent=l.t;if(l.bad)p.style.color='#b42318';box.appendChild(p);});};
    window.__vkDiagRender();
    document.body.insertBefore(box,document.body.firstChild);
  },8000);
})();`;
