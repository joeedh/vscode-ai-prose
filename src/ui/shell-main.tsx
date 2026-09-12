import { render } from "preact";
import { Shell } from "./shell";
import "./styles.css";

const root = document.getElementById("root");
const bridge = window.aiprose;
if (root && bridge) {
	render(<Shell bridge={bridge} />, root);
}
