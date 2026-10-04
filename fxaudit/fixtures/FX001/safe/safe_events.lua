-- Already validated by safe_events.
SafeEvents.register('pizza:pay', {
    args = { { name = 'amount', type = 'integer', min = 1, max = 500 } },
}, function(xPlayer, args)
    xPlayer.addMoney(args.amount)
end)
