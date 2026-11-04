# The person behind a desktop-app API request (browser requests use Devise's current_user).
class Current < ActiveSupport::CurrentAttributes
  attribute :api_user

  def user = api_user
end
