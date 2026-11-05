// Interface copy only. User messages, documents and prompts are never translated.
export const translations: Record<string, string> = {
  "Pilih LLM untuk balasan AI akaun anda. Setiap pengguna menggunakan provider dan API key sendiri. ": "Choose the AI provider for your account. Each user supplies their own provider and API key. ",
  "Key dihantar ke server dan disimpan dalam fail env peribadi akaun anda.": "The key is sent to the server and saved in your account’s private env file.",
  "Simpan profil sambungan Supabase anda sendiri. URL dan API key ini hanya boleh diurus oleh akaun anda.": "Save your own Supabase connection profile. Only your account can manage this URL and these API keys.",
  "Profil ini tidak menukar sambungan aplikasi. Login, database dan fail masih menggunakan projek pemasangan dengan pengasingan data melalui RLS.": "This profile does not switch the app connection. Sign-in, database and files still use the installation project with data isolated through RLS.",
  "Projek sendiri perlu menyediakan schema, storage dan akaun yang diperlukan LokalChat. Data tidak dipindahkan apabila profil disimpan.": "Your project needs the schema, storage and accounts required by LokalChat. Saving this profile does not move data.",
  "Gunakan sb_publishable_ atau legacy anon. Key ini boleh digunakan oleh browser bagi projek anda.": "Use sb_publishable_ or a legacy anon key. This key can be used by the browser for your project.",
  "Profil Supabase disimpan untuk akaun anda sahaja. Sambungan aplikasi tidak berubah.": "Supabase profile saved for your account only. The app connection is unchanged.",
  "Simpanan mengesahkan format sahaja. Key, sambungan dan schema projek belum diuji.": "Saving checks format only. The keys, connection and project schema have not been tested.",

  " baharu (pilihan)": " new (optional)",
  "24 Jam": "24 hours",
  "7 Hari": "7 days",
  "30 Hari": "30 days",
  Abaikan: "Dismiss",
  "Ada stok tak?": "Is this in stock?",
  "Analisis Handoff": "Handoff analysis",
  "Anda mengambil alih": "You are in control",
  "Arahan personaliti dan peraturan untuk ejen AI anda.":
    "Personality instructions and rules for your AI agent.",
  "Balas manual (bot masih aktif)…": "Reply manually (bot still active)…",
  "Balasan pelanggan": "Customer reply",
  Batal: "Cancel",
  "Belum ada dokumen dimuat naik": "No documents uploaded yet",
  "Belum ada kandungan.": "No content yet.",
  "Belum ada mesej.": "No messages yet.",
  "Belum ada perbualan. Guna simulator di bawah untuk menguji bot.":
    "No conversations yet. Use the simulator below to test your bot.",
  "Belum dijawab": "Unanswered",
  "Belum mengesahkan diterima atau dibaca pelanggan.":
    "Customer delivery and read receipts have not been confirmed.",
  "Bot aktif": "Bot active",
  "Bot anda sudah hidup!": "Your bot is live!",
  Buka: "Open",
  "Buka perbualan": "Open conversation",
  "Cadangan tindakan:": "Suggested action:",
  "Cara mendapatkan URL projek dan API key Supabase":
    "How to find your Supabase project URL and API keys",
  "Carian kata kunci": "Keyword search",
  "Carian semantik tersedia": "Semantic search available",
  "Contoh: Anda ialah pembantu kedai yang mesra, jawab dalam Bahasa Melayu santai…":
    "Example: You are a friendly store assistant. Reply in conversational English…",
  "Cuba Semula": "Retry",
  "Cuba bot anda": "Test your bot",
  "Cuba lagi": "Try again",
  "Cuba semula": "Retry",
  "Cubaan:": "Attempts:",
  Daripada: "Out of",
  Diabaikan: "Dismissed",
  Disambung: "Connected",
  Ditanya: "Asked",
  "Diterima Meta": "Accepted by Meta",
  "Endpoint HTTPS awam yang serasi dengan OpenAI. Jangan tambah /chat/completions.":
    "A public HTTPS endpoint compatible with OpenAI. Do not append /chat/completions.",
  "Entri dipadam": "Entry deleted",
  "FAQ berjaya disimpan": "FAQ saved",
  "FAQ dan kandungan dipelajari": "FAQs and learned content",
  "FAQ disimpan dan soalan ditanda selesai": "FAQ saved and question resolved",
  "FAQ disimpan dengan carian kata kunci": "FAQ saved with keyword search",
  "Fail berjaya dipadam": "File deleted",
  Gagal: "Failed",
  "Gagal memadam fail": "Could not delete file",
  "Gagal memuatkan prestasi.": "Could not load performance data.",
  "Gagal menyambung WhatsApp": "Could not connect WhatsApp",
  "Gunakan ID model daripada provider anda yang menyokong chat completions dan tool calling.":
    "Use a provider model ID that supports chat completions and tool calling.",
  "Gunakan sb_publishable_ atau legacy anon. Key ini digunakan oleh browser.":
    "Use sb_publishable_ or a legacy anon key. This key is used by the browser.",
  "Gunakan sb_secret_ atau legacy service_role. Disimpan untuk kegunaan server sahaja.":
    "Use sb_secret_ or a legacy service_role key. Stored for server use only.",
  "Hantar satu mesej ujian melalui simulator.":
    "Send a test message through the simulator.",
  "ID model": "Model ID",
  "Isi konfigurasi Supabase anda sendiri untuk login, database dan fail. Semua pengguna yang login boleh menyimpannya tanpa bantuan admin.":
    "Configure Supabase for sign-in, database and files. Any signed-in user can save these settings without an admin.",
  "Isi maklumat bisnes": "Add business details",
  Jawapan: "Answer",
  "Kadar Handoff": "Handoff rate",
  "Kandungan ini akan dikeluarkan daripada carian AI. Tindakan ini tidak boleh dibatalkan.":
    "This content will be removed from AI search. This cannot be undone.",
  "Kemas kini kredensial": "Update credentials",
  "Key dihantar ke server dan disimpan dalam fail env pemasangan ini.":
    "The key is sent to the server and saved in this installation’s env file.",
  "Key sudah disimpan": "Key saved",
  "Key sudah disimpan. Biarkan kosong untuk mengekalkannya.":
    "A key is already saved. Leave blank to keep it.",
  "Key sudah disimpan. Biarkan kosong untuk mengekalkannya. ":
    "A key is already saved. Leave blank to keep it. ",
  "Konfigurasi AI disimpan dan digunakan untuk balasan seterusnya.":
    "AI settings saved. They apply to subsequent replies.",
  "Konfigurasi AI tidak dapat dimuatkan.": "Could not load AI settings.",
  "Konfigurasi Supabase disimpan. Restart aplikasi untuk memuatkan tetapan. Production memerlukan build semula dan restart menggunakan fail env yang sama.":
    "Supabase settings saved. Restart the app to load them. Production requires a rebuild and restart with the same env file.",
  "Konfigurasi Supabase tidak dapat dimuatkan.":
    "Could not load Supabase settings.",
  "Konfigurasi daripada Settings sedang digunakan.":
    "The saved configuration is active.",
  "Konfigurasi gagal disimpan. Semak input, akses tulis fail env dan sambungan server, kemudian cuba semula.":
    "Could not save settings. Check the input, env file write access and server connection, then retry.",
  "Latih ejen AI dengan dokumen dan arahan kedai anda":
    "Train your AI agent with your store’s documents and instructions",
  Masa: "Time",
  "Masa Dijimatkan": "Time saved",
  "Masukkan API key provider anda": "Enter your provider API key",
  "Masukkan API key untuk provider ini": "Enter an API key for this provider",
  "Masukkan kedua-dua API key untuk projek ini":
    "Enter both API keys for this project",
  "Masukkan nama bisnes anda.": "Enter your business name.",
  "Memadam…": "Deleting…",
  "Memuat naik…": "Uploading…",
  "Memuatkan FAQ…": "Loading FAQs…",
  "Memuatkan data…": "Loading data…",
  "Memuatkan konfigurasi AI…": "Loading AI settings…",
  "Memuatkan konfigurasi Supabase…": "Loading Supabase settings…",
  "Memuatkan mesej…": "Loading messages…",
  "Memuatkan perbualan…": "Loading conversations…",
  "Memuatkan sambungan…": "Loading connection…",
  "Memuatkan…": "Loading…",
  "Mencuba semula…": "Retrying…",
  "Menghantar…": "Sending…",
  "Menguji sambungan...": "Testing connection...",
  "Menunggu penghantaran": "Waiting to send",
  "Menyimpan…": "Saving…",
  "Mesej Auto-Dijawab": "Automatically answered",
  "Mesej disimpan tetapi penghantaran gagal. Tekan Cuba Semula pada mesej tersebut.":
    "Message saved but delivery failed. Select Retry on the message.",
  "Mesej gagal dimuatkan. Sistem akan cuba memuatkan semula.":
    "Could not load messages. The app will retry.",
  "Mesej pelanggan": "Customer message",
  "Muat naik fail atau tulis system prompt.":
    "Upload a file or write a system prompt.",
  "Muat naik gagal": "Upload failed",
  "Nombor telefon": "Phone number",
  "PDF, DOCX, CSV atau TXT — maksimum 10MB setiap fail":
    "PDF, DOCX, CSV or TXT — maximum 10MB per file",
  Padam: "Delete",
  "Padam entri ini?": "Delete this entry?",
  "Padam fail ini?": "Delete this file?",
  "Paling kerap ditanya": "Most asked",
  "Panduan langkah demi langkah": "Step-by-step guide",
  "Paparkan publishable key": "Show publishable key",
  "Paparkan secret key": "Show secret key",
  Pelanggan: "Customer",
  "Penghantaran belum disahkan. Draf dikekalkan. Semak & cuba semula menggunakan ID permintaan yang sama.":
    "Delivery is unconfirmed. Your draft is kept. Check and retry using the same request ID.",
  "Penghantaran gagal": "Delivery failed",
  "Penghantaran semula gagal. Status terkini dimuat semula; tekan Cuba Semula jika mesej masih gagal.":
    "Retry failed. The latest status was reloaded; select Retry if the message still failed.",
  "Penghantaran tidak berjaya. Semak sambungan WhatsApp anda dan cuba semula.":
    "Delivery failed. Check your WhatsApp connection and retry.",
  "Perbualan (": "Conversations (",
  "Perbualan gagal dimuatkan.": "Could not load conversations.",
  "Permintaan penghantaran gagal. Semak mesej tersimpan sebelum menghantar lagi.":
    "The send request failed. Check saved messages before sending again.",
  "Pilih Fail": "Choose file",
  "Pilih LLM untuk balasan AI LokalChat. Tetapan ini digunakan oleh semua akaun dalam pemasangan ini.":
    "Choose the LLM for LokalChat AI replies. These settings apply to every account on this installation.",
  "Pilih perbualan dahulu": "Choose a conversation first",
  "Pilih satu perbualan untuk mula.": "Choose a conversation to start.",
  "Prestasi Ejen AI": "AI agent performance",
  "Projek baharu perlu menyediakan schema, storage dan akaun yang diperlukan LokalChat. Data tidak dipindahkan. Selepas restart, anda mungkin perlu login semula pada projek baharu.":
    "The new project must have LokalChat’s schema, storage and accounts. Data is not migrated. You may need to sign in again after restarting.",
  "Provider AI": "AI provider",
  "Provider LLM": "LLM provider",
  "Ralat memproses fail": "File processing error",
  "Rentetan pilihan anda sendiri — tampal nilai yang sama dalam konfigurasi webhook Meta App anda.":
    "Choose your own secret string. Paste the same value into your Meta app webhook configuration.",
  "Ringkasan automasi WhatsApp kedai anda":
    "Your store’s WhatsApp automation summary",
  "Sahkan nombor WhatsApp Business anda. Kredensial dihantar ke server dan disimpan secara disulitkan.":
    "Verify your WhatsApp Business number. Credentials are sent to the server and stored encrypted.",
  "Sambung Semula": "Reconnect",
  "Sambung WhatsApp": "Connect WhatsApp",
  "Sambungan WhatsApp": "WhatsApp connection",
  "Sambungan WhatsApp berjaya disahkan": "WhatsApp connection verified",
  "Sambungan WhatsApp terputus — sila sambung semula":
    "WhatsApp disconnected — please reconnect",
  "Sambungkan nombor WhatsApp Business anda.":
    "Connect your WhatsApp Business number.",
  "Sebab utama AI menyerahkan perbualan kepada manusia. Klik untuk lihat cadangan tindakan.":
    "Top reasons AI hands conversations to a person. Select one to see suggested actions.",
  "Sedang dihantar": "Sending",
  "Sedang diproses…": "Processing…",
  "Selepas FAQ wujud": "After FAQ was added",
  Selesai: "Resolved",
  "Semak & cuba semula": "Check & retry",
  "Sembunyikan panduan": "Hide guide",
  "Sembunyikan publishable key": "Hide publishable key",
  "Sembunyikan secret key": "Hide secret key",
  Semua: "All",
  "Semua langkah persediaan selesai. Pelanggan kini boleh berbual dengan ejen AI anda.":
    "Setup is complete. Customers can now chat with your AI agent.",
  "Seret &amp; lepas fail di sini": "Drag & drop files here",
  "Sesi dikendalikan sepenuhnya oleh bot": "Sessions fully handled by the bot",
  "Sesi tamat. Sila log masuk semula.":
    "Your session expired. Please sign in again.",
  "Siapkan langkah sebelumnya dahulu.": "Complete the previous step first.",
  "Simpan FAQ": "Save FAQ",
  "Simpan System Prompt": "Save system prompt",
  "Simpan konfigurasi AI": "Save AI configuration",
  "Simpan konfigurasi Supabase": "Save Supabase configuration",
  "Simpanan ini tidak menguji kesahihan key, kredit atau akses model pada provider.":
    "Saving does not test the key, credits or model access with the provider.",
  "Simpanan mengesahkan format sahaja. Key, sambungan dan schema projek belum diuji. Ikut panduan pemasangan sebelum bertukar projek.":
    "Saving validates format only. Keys, connectivity and project schema are not tested. Follow the installation guide before switching projects.",
  Simulasi: "Simulate",
  "Simulasi gagal. Semak konfigurasi AI kedai.":
    "Simulation failed. Check your store’s AI configuration.",
  "Simulator menggunakan AI dan data kedai sebenar. Mesej direkod dalam inbox; tiada WhatsApp dihantar.":
    "The simulator uses real AI and store data. Messages are recorded in the inbox; no WhatsApp is sent.",
  Soalan: "Question",
  "Soalan Tidak Dijawab": "Unanswered questions",
  "Soalan diabaikan": "Question dismissed",
  "Soalan pelanggan yang bot tidak pasti jawapannya. Tambah ke FAQ supaya bot boleh jawab lain kali.":
    "Questions your bot could not confidently answer. Add an FAQ so it can answer next time.",
  "Status bot gagal dikemas kini. Cuba lagi.":
    "Could not update bot status. Try again.",
  Susun: "Sort",
  "System prompt berjaya disimpan": "System prompt saved",
  "Taip balasan anda…": "Type your reply…",
  "Tambah FAQ": "Add FAQ",
  "Tambah FAQ & system prompt": "Add FAQs & a system prompt",
  "Tambah jawapan kedai secara terus. Senarai turut mengandungi petikan dokumen, maksimum 100 entri terkini.":
    "Add store answers directly. This list also contains document excerpts, up to the latest 100 entries.",
  "Tambah ke FAQ": "Add to FAQ",
  Terbaru: "Newest",
  Terlama: "Oldest",
  Teruskan: "Continue",
  "Tetapan dikongsi semua akaun pada pemasangan LokalChat ini.":
    "These settings are shared by all accounts on this LokalChat installation.",
  "Tiada cadangan direkodkan untuk sebab ini.":
    "No suggestion recorded for this reason.",
  "Tiada handoff dalam tempoh ini 🎉": "No handoffs in this period",
  "Tiada soalan dalam senarai ini.": "No questions in this list.",
  Tindakan: "Action",
  "Tulis jawapan. Bot akan guna jawapan ini untuk soalan yang serupa.":
    "Write an answer. Your bot will use it for similar questions.",
  "Tutup checklist": "Dismiss checklist",
  "URL projek": "Project URL",
  "URL projek HTTPS atau HTTP localhost. Tanpa /rest/v1 atau /auth/v1.":
    "HTTPS project URL or HTTP localhost, without /rest/v1 or /auth/v1.",
  "Uji & Simpan Sambungan": "Test & Save Connection",
  "Urus perbualan WhatsApp pelanggan anda":
    "Manage your customer WhatsApp conversations",
  "dan semua kandungan yang dipelajari daripadanya akan dipadam terus. Tindakan ini tidak boleh dibatalkan.":
    "and all content learned from it will be permanently deleted. This cannot be undone.",
  daripada: "of",
  "daripada 4 langkah siap": "of 4 steps complete",
  mesej: "messages",
  "mesej keseluruhan": "total messages",
  sesi: "sessions",
  Sembunyi: "Hide",
  Papar: "Show",
  "⚠️ Human Action Required": "Human action required",
  "× walaupun FAQ sudah ada": "times despite an existing FAQ",
  "× — semua kejadian:": "times — all occurrences:",
  "Pilih LLM untuk balasan AI LokalChat. Tetapan ini digunakan oleh semua akaun dalam pemasangan ini. ":
    "Choose the LLM for LokalChat AI replies. These settings apply to every account on this installation. ",
  "Sahkan nombor WhatsApp Business anda. Kredensial dihantar ke server dan disimpan secara disulitkan. ":
    "Verify your WhatsApp Business number. Credentials are sent to the server and stored encrypted. ",
  "Disambung ": "Connected ",
  "Kemas kini kredensial ": "Update credentials ",
  "Sambungan WhatsApp terputus — sila sambung semula ":
    "WhatsApp disconnected — please reconnect ",
  "Sambung Semula ": "Reconnect ",
  "Rentetan pilihan anda sendiri — tampal nilai yang sama dalam konfigurasi webhook Meta App anda. ":
    "Choose your own secret string. Paste the same value into your Meta app webhook configuration. ",
  "Gagal memuatkan prestasi. ": "Could not load performance data. ",
  "Mesej Auto-Dijawab ": "Automatically answered ",
  " mesej": " messages",
  "Daripada ": "Out of ",
  " mesej keseluruhan ": " total messages ",
  "Masa Dijimatkan ": "Time saved ",
  "Sesi dikendalikan sepenuhnya oleh bot ":
    "Sessions fully handled by the bot ",
  "Kadar Handoff ": "Handoff rate ",
  " daripada ": " of ",
  " sesi ": " sessions ",
  "Sebab utama AI menyerahkan perbualan kepada manusia. Klik untuk lihat cadangan tindakan. ":
    "Top reasons AI hands conversations to a person. Select one to see suggested actions. ",
  "Perbualan gagal dimuatkan. ": "Could not load conversations. ",
  "Nombor telefon ": "Phone number ",
  "Mesej pelanggan ": "Customer message ",
  "Simulasi ": "Simulate ",
  " dan semua kandungan yang dipelajari daripadanya akan dipadam terus. Tindakan ini tidak boleh dibatalkan. ":
    " and all content learned from it will be permanently deleted. This cannot be undone. ",
  "Ditanya ": "Asked ",
  "Gagal ": "Failed ",
  "× walaupun FAQ sudah ada ": "times despite an existing FAQ ",
  "Tambah ke FAQ ": "Add to FAQ ",
  "Abaikan ": "Dismiss ",
  "Buka perbualan ": "Open conversation ",
  "Belum ada perbualan. Guna simulator di bawah untuk menguji bot. ":
    "No conversations yet. Use the simulator below to test your bot. ",
  "⚠️ Human Action Required ": "Human action required ",
  "Cubaan: ": "Attempts: ",
  " daripada 4 langkah siap": " of 4 steps complete",
  "Teruskan ": "Continue ",
  "Buka ": "Open ",
};
