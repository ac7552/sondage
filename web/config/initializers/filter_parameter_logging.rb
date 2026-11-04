Rails.application.config.filter_parameters += [
  :passw, :share, :piece, :email, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc, :signature, :receipt
]
