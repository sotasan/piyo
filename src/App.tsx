import { Group, Panel, Separator } from "react-resizable-panels";
import Sidebar from "./components/Sidebar";
import Terminal from "./components/Terminal";
import "./App.css";

function App() {
  return (
    <div className="app">
      <div className="drag-bar" data-tauri-drag-region />
      <Group className="app-body" orientation="horizontal">
        <Panel
          defaultSize="200px"
          minSize="48px"
          maxSize="480px"
          groupResizeBehavior="preserve-pixel-size"
        >
          <Sidebar />
        </Panel>
        <Separator />
        <Panel>
          <Terminal />
        </Panel>
      </Group>
    </div>
  );
}

export default App;
