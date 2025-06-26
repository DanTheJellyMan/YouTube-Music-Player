const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");

/**
 * Handle login/sign up requests
 * @param {string} url Login/Sign up path
 */
async function account(url) {
    const username = usernameInput.value.trim().normalize("NFKC");
    const password = passwordInput.value.trim().normalize("NFKC");
    if (!validateInput(username, password)) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("Timeout"), 1000*60);

    console.log(JSON.stringify({ url, username, password }, null, 4));
    const res = await fetch(url, {
        "method": "POST",
        "headers": {
            "Content-Type": "application/json"
        },
        "body": JSON.stringify({ username, password }),
        "signal": controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
        alert(await res.text());
    } else {
        window.location = "/home";
    }
}

function validateInput(username, password) {
    const reasons = [];
    let ok = false;

    if (username.length < 2 || username.length > 100) {
        reasons.push(`Username length (${username.length}) must be between 2 and 100`);
    }
    if (password.length < 2 || password.length > 100) {
        reasons.push(`Password length (${password.length}) must be between 2 and 100`);
    }

    if (reasons.length === 0) {
        ok = true;
    } else {
        alert(reasons.join("\n"));
    }
    return ok;
}