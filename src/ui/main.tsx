import { render } from "preact";
import "./styles.css";

// CLAUDENOTE: wave 5 replaces this with the app.
function App() {
	return <div class="app">ai-prose</div>;
}

const root = document.getElementById("root");
if (root) {
	render(<App />, root);
}
