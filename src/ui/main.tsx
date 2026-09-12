import { render } from "preact";
import { App } from "./app";
import { detectTransport } from "./transport";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
	render(<App transport={detectTransport()} />, root);
}
