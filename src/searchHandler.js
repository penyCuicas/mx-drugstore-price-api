const DbHandler = require('../src/db/dbHandler');

class SearchHandler {

    static async checkIsPremiumUser(userName) {
        const user = await DbHandler.getUserByLogin(userName);
        console.log(user.validUntil, new Date());
        return user.validUntil != null && new Date() < user.validUntil;
    }

    static async execute(queryText) {
        var sites = {
            order : []
        };
        var result = {
            sites: []
        }
        var prices = await DbHandler.executeProductSearch(queryText);
        //console.log(prices);
        if (prices.length) {
            var websites = await DbHandler.getWebsites();
            //console.log(websites);

            prices.forEach(p => {
                var website = websites[p.websiteId];
                if (!(p.websiteId in sites)) {
                    sites.order.push(p.websiteId);
                    sites[p.websiteId] = {
                        drugStoreName: website.name,
                        drugStoreNameUrl: website.url,
                        urlFromGoogle: website.urlFromGoogle,
                        products:[]
                    }
                }
                //TODO remove attributes from p in case is not logged in
                sites[p.websiteId].products.push(p);
            });
        }
        
        sites.order.forEach(key => {
            result.sites.push(sites[key]);
        })

        return result;
    }

}

module.exports = SearchHandler;