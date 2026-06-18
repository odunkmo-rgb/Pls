# Güvenlik Botu

Discord sunucularını yetkisiz işlemlere karşı koruyan, log tutan ve otomatik yedek alan güvenlik botu.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API sunucusu + Discord botu başlat (port 8080)
- `pnpm run typecheck` — tam typecheck
- `pnpm run build` — typecheck + build

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Discord: discord.js v14
- Zamanlayıcı: node-cron
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/api-server/src/bot/` — Tüm bot mantığı
- `artifacts/api-server/src/bot/config.ts` — Rol ID'leri, limit ayarları
- `artifacts/api-server/src/bot/handlers/` — Event handler'lar
- `artifacts/api-server/src/bot/utils/` — Yardımcı araçlar

## Bot Özellikleri

- **Aksiyon limiti (2 hak):** Whitelist dışı yetkililer ban/kick/kanal silmede 2 hakka sahip, 3.'de yetkileri alınır
- **Mute istisnası:** Mute işlemleri bu sisteme dahil değil
- **Log kanalı:** Tüm işlemler #1517200943488176279 kanalına anlık loglanır
- **DM güvenliği:** Log mesajı silinirse admin rolü sahiplerine DM gönderilir
- **Karantina sistemi:** `/karantina-ekle` ile işaretlenen kullanıcılar sunucuya girince rolleri alınıp karantina rolü verilir
- **Gece yedeği:** Her gece 00:00'da sunucu yedeği alınır
- **Geri yükleme:** `/restore` ile tek tıkla eksik kanallar geri gelir

## Slash Komutları

| Komut | Açıklama |
|---|---|
| `/karantina-ekle @kullanıcı` | İzleme listesine ekler |
| `/karantina-kaldir @kullanıcı` | İzleme listesinden çıkarır |
| `/karantina-liste` | Listeyi gösterir |
| `/yedek-al` | Anlık yedek alır |
| `/restore` | Son yedekten eksik kanalları geri yükler |
| `/yedek-bilgi` | Son yedek bilgisi |
| `/sayac-sifirla @kullanıcı` | İşlem sayacını sıfırlar |
| `/sayac-goruntule @kullanıcı` | Sayacı gösterir |
| `/yardim` | Tüm komutları listeler |

## Muaf Roller (config.ts'de tanımlı)

- `1513128921384882287`
- `1515714160053194792`
- `1515760496425308300`

## Karantina Rolü

- `1513129015735615550`

## Log Kanalı

- `1517200943488176279`

## User preferences

- Türkçe arayüz ve komutlar
- Sunucu güvenliği öncelikli

## Gotchas

- `ACTION_WINDOW_MS: 0` = sınırsız süre penceresi (sıfırlanana kadar sayaç birikir)
- Karantina listesi bellekte tutulur, bot yeniden başlarsa sıfırlanır — kalıcı liste için DB eklenmeli
- Discord audit log verisi ~1 sn gecikmeyle gelir, handler'larda 1 sn bekleme var
