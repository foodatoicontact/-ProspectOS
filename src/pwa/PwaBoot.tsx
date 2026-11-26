'use client';
// Mounted once by the root layout: registers the service worker and keeps the install prompt (src/pwa/client.ts).
// Renders nothing; shows nothing on any page.
import {useEffect} from 'react';
import {bootPwa} from './client.ts';
export function PwaBoot(){useEffect(()=>{bootPwa()},[]);return null}
