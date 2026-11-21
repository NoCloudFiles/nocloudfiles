import { parseCards } from "./contacts.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ cards: parseCards(data) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
