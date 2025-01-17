import { debounce } from 'throttle-debounce';

import React from 'react';
import ReactDOM from 'react-dom';

import '!style-loader!css-loader!@blueprintjs/datetime/lib/css/blueprint-datetime.css';
import '!style-loader!css-loader!jsondiffpatch/dist/formatters-styles/annotated.css';
import '!style-loader!css-loader!jsondiffpatch/dist/formatters-styles/html.css';
import '!style-loader!css-loader!@blueprintjs/core/lib/css/blueprint.css';
import '!style-loader!css-loader!@blueprintjs/popover2/lib/css/blueprint-popover2.css';
import '!style-loader!css-loader!react-resizable/css/styles.css';
import '!style-loader!css-loader!./normalize.css';
import '!style-loader!css-loader!./renderer.css';

import ErrorBoundary from '@riboseinc/paneron-extension-kit/widgets/ErrorBoundary';
import MainWindow from './MainWindow/index';

import { colorSchemeUpdated } from 'common';


// Set color scheme

function applyColorScheme(opts: { colorSchemeName: string }) {
  if (opts.colorSchemeName === 'dark') {
    document.body.classList.add('bp4-dark');
    document.body.style.backgroundColor = 'black';
  } else {
    document.body.classList.remove('bp4-dark');
    document.body.style.backgroundColor = 'white';
  }
}

// Params passed to the window from main via GET query string
const searchParams = new URLSearchParams(window.location.search);
const colorScheme = searchParams.get('colorScheme');
if (colorScheme) { applyColorScheme({ colorSchemeName: colorScheme }); }

// electron-webpack guarantees presence of #app in index.html it bundles
const containerEl: HTMLElement | null = document.getElementById('app');
if (containerEl === null) {
  throw new Error("Missing app container");
}

// Do the rest.
//
// NOTE: Moving this logic out of async function causes a crash on hot reload
// when working on renderer code in yarn dev mode.

async function renderApp() {
  //require('events').EventEmitter.defaultMaxListeners = 20;

  const applyColorSchemeDebounced = debounce(1000, applyColorScheme);
  colorSchemeUpdated.renderer!.handle(applyColorSchemeDebounced);

  ReactDOM.render(
    <ErrorBoundary viewName="Main window">
      <MainWindow />
    </ErrorBoundary>,
    containerEl);
}

renderApp();


import 'common';
import 'repositories/ipc';
import 'datasets/ipc';
