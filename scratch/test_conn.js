async function test() {
  console.log("Testing localhost:8000...");
  try {
    const res = await fetch('http://localhost:8000/health');
    console.log("localhost success:", res.status);
  } catch (e) {
    console.log("localhost failed:", e.message);
  }

  console.log("\nTesting 127.0.0.1:8000...");
  try {
    const res = await fetch('http://127.0.0.1:8000/health');
    console.log("127.0.0.1 success:", res.status);
  } catch (e) {
    console.log("127.0.0.1 failed:", e.message);
  }
}

test();
