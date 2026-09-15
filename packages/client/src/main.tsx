import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './index.css';
import { Landing } from './views/Landing.js';
import { CampaignGate } from './views/CampaignGate.js';
import { applyUiScale, useUi } from './stores/ui.js';

// Text size (issue #126): the stored preset applies before the first paint
// and follows the store from then on.
applyUiScale(useUi.getState().uiScale);
useUi.subscribe((s, prev) => {
  if (s.uiScale !== prev.uiScale) applyUiScale(s.uiScale);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/c/:campaignId" element={<CampaignGate />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
