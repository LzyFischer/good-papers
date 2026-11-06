// Pixel nicknames for NeurIPS Quest players: the same one every time for the same id, and
// never a real name. Shared by the server (chat) and the browser (who's in the hall).
const ADJ = ["Curious", "Sleepy", "Bold", "Tiny", "Lucky", "Quiet", "Speedy", "Brave", "Fuzzy", "Clever", "Sunny", "Witty"];
const ANIMAL = ["Llama", "Alpaca", "Falcon", "Mamba", "Owl", "Fox", "Panda", "Otter", "Koala", "Tiger", "Gecko", "Puffin"];
export const SHIRTS = ["#e05a5a", "#33b0dd", "#c37ad2", "#4fbf4f", "#f4efe2", "#ff9f43", "#7c82f0", "#ffcc33"];

export const idHash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;

export function nickFor(id: string): string {
  const h = idHash(id);
  return `${ADJ[h % ADJ.length]} ${ANIMAL[Math.floor(h / ADJ.length) % ANIMAL.length]} ${(h % 89) + 10}`;
}
