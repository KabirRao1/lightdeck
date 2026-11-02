import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

// The widget is not a web page: suppress the browser context menu (presets use right-click for "remove").
document.addEventListener("contextmenu", e => e.preventDefault());

export default mount(App, { target: document.getElementById("app")! });
