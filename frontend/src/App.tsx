import { HashRouter, Route, Routes } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import AppShell from "@/components/AppShell"
import Overview from "@/pages/Overview"
import Detail from "@/pages/Detail"
import UploadPage from "@/pages/Upload"
import ModelPage from "@/pages/Model"
import LibraryPage from "@/pages/Library"

export default function App() {
  return (
    <HashRouter>
      <TooltipProvider>
        <AppShell>
          <div className="mx-auto max-w-[1400px]">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/video/:id" element={<Detail />} />
              <Route path="/library/:id" element={<LibraryPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/model" element={<ModelPage />} />
              <Route path="/clips" element={<Overview />} />
              <Route path="*" element={<Overview />} />
            </Routes>
          </div>
        </AppShell>
      </TooltipProvider>
    </HashRouter>
  )
}
