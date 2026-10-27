// Can you hear entanglement? A notebook told with music.
// The notebook cells live in notebook/, the full editor in lab/, and every circuit is
// built and computed by Qiskit in musicbox/ (Python, run in the browser by Qollab).
const engine = null; // browser preview: no Qiskit here, the built-in simulator plays every cell
import { initNotebook } from "./notebook/notebook.js";
import { initLab } from "./lab/musicbox.js";

// Qollab creates `backend` from the Select QPU dialog when you press Run.
const getBackend = () => (typeof backend !== "undefined" ? backend : null);

document.documentElement.lang = "en";
document.title = "Can you hear entanglement?";
initLab(engine, getBackend);
initNotebook(engine, getBackend);
