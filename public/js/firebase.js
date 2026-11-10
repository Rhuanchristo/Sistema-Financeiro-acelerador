// Inicialização do Firebase. Os demais módulos importam Firebase somente daqui.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js";

// Em localhost o app usa sempre os emuladores locais (projeto demo), nunca o banco de produção.
export const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
export const app = initializeApp(LOCAL ? { ...firebaseConfig, projectId: "demo-financeiro", apiKey: "demo-key" } : firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
if (LOCAL) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
}

export {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
export {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc,
  writeBatch, collectionGroup, query, where, orderBy, limit, getCountFromServer,
  serverTimestamp, Timestamp, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
