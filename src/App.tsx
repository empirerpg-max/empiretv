import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Home from "./routes/home";
import AoVivo from "./routes/ao-vivo";
import Grade from "./routes/grade";
import Arquivo from "./routes/arquivo";
import NavBar from "./components/NavBar";

export type Tab = "home" | "ao-vivo" | "grade" | "arquivo";

const variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
};

export default function App() {
  const [tab, setTab] = useState<Tab>("home");

  return (
    <div className="app-shell">
      <div className="app-content">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ height: "100%" }}
          >
            {tab === "home"    && <Home    onNavigate={setTab} />}
            {tab === "ao-vivo" && <AoVivo />}
            {tab === "grade"   && <Grade />}
            {tab === "arquivo" && <Arquivo />}
          </motion.div>
        </AnimatePresence>
      </div>
      <NavBar current={tab} onNavigate={setTab} />
    </div>
  );
}
