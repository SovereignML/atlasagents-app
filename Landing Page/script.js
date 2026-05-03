document.addEventListener("DOMContentLoaded", () => {
    // Add floating animations to avatars
    const avatars = document.querySelectorAll('.avatar');
    avatars.forEach((avatar, index) => {
        avatar.animate([
            { transform: `translate(${avatar.classList.contains('avatar-3') ? '-50%' : '0'}, 0px)` },
            { transform: `translate(${avatar.classList.contains('avatar-3') ? '-50%' : '0'}, ${-8 - (index % 3) * 4}px)` },
            { transform: `translate(${avatar.classList.contains('avatar-3') ? '-50%' : '0'}, 0px)` }
        ], {
            duration: 3500 + (index * 600),
            iterations: Infinity,
            easing: 'ease-in-out'
        });
    });

    // Add subtle animation to blurred background elements
    const blurBot = document.querySelector('.blur-bot');
    if(blurBot) {
        blurBot.animate([
            { transform: 'rotate(-15deg) translateY(0px)' },
            { transform: 'rotate(-12deg) translateY(-10px)' },
            { transform: 'rotate(-15deg) translateY(0px)' }
        ], {
            duration: 6000,
            iterations: Infinity,
            easing: 'ease-in-out'
        });
    }

    const blurWave = document.querySelector('.blur-wave');
    if(blurWave) {
        blurWave.animate([
            { transform: 'translateY(0px) scale(1)' },
            { transform: 'translateY(-15px) scale(1.05)' },
            { transform: 'translateY(0px) scale(1)' }
        ], {
            duration: 7000,
            iterations: Infinity,
            easing: 'ease-in-out'
        });
    }

    // Dark Mode Toggle Logic
    const themeToggle = document.getElementById('theme-toggle');
    const moonIcon = document.querySelector('.moon-icon');
    const sunIcon = document.querySelector('.sun-icon');

    // Check for saved theme preference
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
        moonIcon.style.display = 'none';
        sunIcon.style.display = 'block';
    }

    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        
        if (isDark) {
            localStorage.setItem('theme', 'dark');
            moonIcon.style.display = 'none';
            sunIcon.style.display = 'block';
        } else {
            localStorage.setItem('theme', 'light');
            moonIcon.style.display = 'block';
            sunIcon.style.display = 'none';
        }
    });
});
