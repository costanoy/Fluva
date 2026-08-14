/**
 * Builds a static PIX "Copia e Cola" payload (BR Code / EMV QR Code, the
 * format the Central Bank defines for PIX) — the string a QR code of it
 * encodes is exactly what any bank app scans to pre-fill a transfer to this
 * key, with no fixed amount so the payer chooses how much to send.
 */

function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) — the checksum algorithm the BR Code spec requires for its final field. */
function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildPixPayload({ key, name, city }: { key: string; name: string; city: string }): string {
  const merchantAccountInfo = tlv('00', 'br.gov.bcb.pix') + tlv('01', key);
  const additionalData = tlv('05', '***'); // txid — "***" is the standard placeholder for a static, reusable code.

  // The CRC covers the whole payload up to and including this field's own id+length ("6304"),
  // so that fixed tail is appended before computing it, then replaced by the real checksum.
  const withoutCrc =
    tlv('00', '01') +
    tlv('26', merchantAccountInfo) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('58', 'BR') +
    tlv('59', name.slice(0, 25)) +
    tlv('60', city.slice(0, 15)) +
    tlv('62', additionalData) +
    '6304';

  return withoutCrc + crc16ccitt(withoutCrc);
}

/** Strips everything but digits — a CPF/phone/random-key PIX key must reach the payload with no punctuation. */
export function normalizePixKey(key: string): string {
  return key.replace(/\D/g, '');
}
