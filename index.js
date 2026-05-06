export default {
  async fetch(request) {
    const TARGET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRHMzfO6FDzd5PrJzUOWzYN5VWny10qF_T36jZZC0nSDuLALQa5pJd8fknGIct8VngnqsAyoActIsLw/pub?output=csv";
    const response = await fetch(TARGET_URL);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    return newResponse;
  }
};
