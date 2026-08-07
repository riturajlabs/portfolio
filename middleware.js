/**
 * Vercel Edge Middleware
 *
 * Adds X-API-Key header before forwarding protected
 * API requests to backend.
 *
 * Secret comes from:
 * BACKEND_API_KEY
 *
 * IMPORTANT:
 * - Never use VITE_ prefix
 * - Never expose this key to browser
 *
 * Production flow:
 *
 * Browser
 *   |
 *   | /api/chat
 *   |
 * Vercel Middleware
 *   |
 *   | X-API-Key injected
 *   |
 * Render AI Service
 */


import { NextResponse } from "next/server";


const PROTECTED_PATHS = [
    "/api/chat",
    "/api/contact",
];


export const config = {

    matcher: [
        "/api/chat/:path*",
        "/api/contact",
    ],

};



export default function middleware(request) {


    const pathname = request.nextUrl.pathname;


    const needsKey = PROTECTED_PATHS.some(
        (path) => pathname.startsWith(path)
    );


    /*
     * Public routes
     */
    if (!needsKey) {

        return NextResponse.next();

    }



    const apiKey = process.env.BACKEND_API_KEY;



    /*
     * Production safety:
     * If env missing, block request.
     */
    if (!apiKey) {

        return new Response(
            JSON.stringify({
                error:
                "API key not configured on proxy."
            }),
            {
                status: 503,
                headers:{
                    "Content-Type":"application/json"
                }
            }
        );

    }



    /*
     * Clone headers
     */
    const requestHeaders = new Headers(
        request.headers
    );


    requestHeaders.set(
        "X-API-Key",
        apiKey
    );



    return NextResponse.next({

        request:{
            headers: requestHeaders,
        },

    });


}