// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check if jQuery is loaded
    if (typeof jQuery === 'undefined') {
        console.error('jQuery is not loaded. Please ensure jQuery is included before script.js.');
        return;
    }

    // Check if Slick is loaded
    if (typeof jQuery.fn.slick === 'undefined') {
        console.error('Slick Carousel is not loaded. Please ensure slick.min.js is included.');
        return;
    }

    console.log('jQuery and Slick Carousel are loaded successfully.');

    const searchForm = document.getElementById('searchForm');

    if (!searchForm) {
        //console.error('Form with ID "searchForm" not found.');
        return;
    }

    searchForm.addEventListener('submit', (e) => {
        e.preventDefault(); // Prevent the default form submission
        console.log('Form submission intercepted');

        const query = document.getElementById('queryInput').value.trim();
        var alertDiv = document.createElement('div');

        if (!query) {
            alert('Please enter a query to search.');
            return;
        }

        fetch('/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: query })
        })
        .then(response => response.json())
        .then(data => {
            const resultsDiv = document.getElementById('results');
            resultsDiv.innerHTML = ''; // Clear previous results

            if (!data.isLoggedIn) {
                alertDiv.innerHTML = `<div id="alertMessage" class="alert alert-warning mt-2" role="alert" style="block">${data.alertNotLoggedIn}.<a href="/register">Registrate</a></div>`
                resultsDiv.appendChild(alertDiv);
            } else if (!data.isPremium) {
                alertDiv.innerHTML = `<div id="alertMessage" class="alert alert-warning mt-2" role="alert" style="block">${data.alertSubscriptionExpired}</div>`
                resultsDiv.appendChild(alertDiv);
            }  
            

            if (!data.sites || data.sites.length === 0) {
                resultsDiv.innerHTML = '<p>No se encontraron resultados.</p>';
                return;
            }

            data.sites.forEach(site => {
                const storeDiv = document.createElement('div');
                storeDiv.className = 'store-carousel';
                storeDiv.innerHTML = `
                    <h2><a href="${site.drugStoreNameUrl}" target="_blank">${site.drugStoreName}</a></h2>
                    <div class="carousel">
                        ${site.products.map(product => `
                            <div class="product">
                                <p><strong>Producto:</strong> ${product.name}</p>
                                <p class="price"><strong>Precio:</strong> <span class="striked-off ${!product.strikeOff ? 'd-none': ''}">$${product.listPrice.toFixed(2)}</span><span class="${product.strikeOff ? 'offer-price': 'price'}">$${product.price.toFixed(2)}</span></p>
                                <p><strong>Disponible:</strong> ${product.available ? 'Si' : 'No'}</p>
                                <p><a class="${!data.isPremium ? 'd-none' : ''}" href="${product.path}" target="_blank">Ver en el sitio</a></p>
                            </div>
                        `).join('')}
                    </div>
                `;
                resultsDiv.appendChild(storeDiv);
            });

            // Check for existing Slick Carousels and destroy them
            const carousels = document.querySelectorAll('.carousel');
            carousels.forEach(carousel => {
                const $carousel = jQuery(carousel);
                // Only call unslick if the carousel is already initialized
                if ($carousel.hasClass('slick-initialized')) {
                    try {
                        $carousel.slick('unslick');
                        console.log('Destroyed existing Slick instance for:', carousel);
                    } catch (error) {
                        console.warn('Error destroying Slick instance:', error);
                    }
                }
            });

            // Initialize new Slick Carousels
            jQuery('.carousel').slick({
                infinite: false,
                slidesToShow: 3,
                slidesToScroll: 1,
                dots: true,
                arrows: true,
                responsive: [
                    {
                        breakpoint: 400,
                        settings: {
                            slidesToShow: 1,
                            slidesToScroll: 1
                        }
                    },
                    {
                        breakpoint: 768,
                        settings: {
                            slidesToShow: 2,
                            slidesToScroll: 1
                        }
                    }
                ]
            });
            console.log('New Slick Carousels initialized');
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            const resultsDiv = document.getElementById('results');
            resultsDiv.innerHTML = '<p>Error loading results. Please try again later.</p>';
        });
    });
});
